# Frontend CI/CD

Frontend CI/CD runs from GitHub Actions. It covers only `web/` and the static
dashboard deployment script; Terraform and the replay parser remain manually
operated.

## Workflows

- `Frontend CI` runs for pull requests and pushes to `main` that change the
  frontend, deploy script, or frontend workflow definitions. It runs `npm ci`,
  `npm run build`, and the Playwright UI suite. Playwright runs with one worker
  in CI to avoid competing requests for the current production-backed fixture.
- `Deploy frontend` runs manually through `workflow_dispatch` from `main`. It
  repeats the frontend checks, deploys to S3, invalidates CloudFront, and
  verifies the public dashboard and `stats.json` return HTTP 200. A manual
  workflow run is the production approval gate for this repository.

The deploy workflow deliberately calls `scripts/deploy-web.sh`, which preserves
the aggregator-owned `stats.json` and `matches.json` objects.

## GitHub Environment

Create an environment named `production` in the repository settings. This
repository does not expose GitHub's required-reviewer protection rule, so the
deploy workflow is intentionally manual-only rather than deploying after every
merge to `main`.

Create the following environment variables:

| Variable | Value |
| --- | --- |
| `AWS_REGION` | AWS region holding the dashboard, currently `us-east-1` |
| `AWS_DEPLOY_ROLE_ARN` | ARN of the OIDC deploy role described below |
| `DASHBOARD_BUCKET` | Terraform output `dashboard_bucket_name` |
| `CLOUDFRONT_DISTRIBUTION_ID` | Terraform output `dashboard_cloudfront_distribution_id` |
| `VITE_UPLOAD_API_URL` | Terraform output `upload_api_url` |
| `VITE_POSTHOG_KEY` | PostHog project token (optional; enables analytics with the host) |
| `VITE_POSTHOG_HOST` | PostHog ingestion host for the project, e.g. `https://us.i.posthog.com` |

These are environment variables rather than secrets because none grants access
by itself. The workflow obtains short-lived AWS credentials through OIDC.

## Visitor analytics

Create a PostHog project and copy its **project token** and ingestion host from
the project settings into the production environment variables above. The token
is public and embedded in the frontend: never use a personal API key. Both
values must be set when building; otherwise analytics is disabled. Local
development is excluded. For a local production build, set the same variables
in `web/.env.production.local` or export them before `scripts/deploy-web.sh`.

The SDK records the initial page view and subsequent History API navigation,
including TanStack Router routes. Click autocapture, pageleave events, dead-click
capture, and session recording are disabled. Visitor identity is a browser-based
estimate, not an exact count of people. Page URLs are sent to PostHog; avoid
putting credentials or other sensitive information in URLs. Tracking can be
blocked by browser settings or extensions.

In PostHog, set the project time zone to Asia/Jakarta, then use Web Analytics or
an insight for `$pageview` to create a dashboard with total pageviews, unique
visitors, and a breakdown by pathname. Set the range to the last 24 hours and
the interval to hourly for traffic by hour. Dynamic paths such as
`/matches/<id>` are separate URLs; group them by route pattern in a custom
insight if a combined total is needed. Check a real production visit and client
navigation in PostHog's activity view after deployment. Data begins at setup;
retention and usage limits depend on the PostHog plan.

## AWS OIDC Role

Add GitHub as an IAM OIDC provider once per AWS account, if it is not already
present:

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

Create a role, for example `dota-replay-dashboard-github-deploy`, with this
trust policy. Replace `<AWS_ACCOUNT_ID>` with the production account ID.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:rizkiprass/dota2-stats:environment:production"
        }
      }
    }
  ]
}
```

Attach the following inline policy. Replace `<DASHBOARD_BUCKET>` and
`<CLOUDFRONT_DISTRIBUTION_ID>` with the values configured in the environment.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListDashboardBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::<DASHBOARD_BUCKET>"
    },
    {
      "Sid": "DeployDashboardAssets",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<DASHBOARD_BUCKET>/*"
    },
    {
      "Sid": "ProtectAggregatorPayloads",
      "Effect": "Deny",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::<DASHBOARD_BUCKET>/stats.json",
        "arn:aws:s3:::<DASHBOARD_BUCKET>/matches.json"
      ]
    },
    {
      "Sid": "InvalidateDashboardCache",
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      "Resource": "arn:aws:cloudfront::<AWS_ACCOUNT_ID>:distribution/<CLOUDFRONT_DISTRIBUTION_ID>"
    }
  ]
}
```

`s3:DeleteObject` is required because `deploy-web.sh` uses `aws s3 sync --delete`.
The role intentionally has no permission to write `stats.json` or
`matches.json`; the deploy script excludes them and the aggregator remains their
only writer.

## First Deployment

1. Create the `production` environment, reviewer rule, and variables.
2. Create the OIDC provider and IAM role, then set its ARN in
   `AWS_DEPLOY_ROLE_ARN`.
3. Open a frontend-only pull request and confirm `Frontend CI` succeeds.
4. Merge it to `main`.
5. From the Actions tab, run `Deploy frontend` on branch `main`.
6. Confirm the smoke test and job summary report the production URL.
