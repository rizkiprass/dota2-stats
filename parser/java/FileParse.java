package opendota;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Thin CLI wrapper around {@link Parse} for use in the MVP Lambda container.
 *
 * The upstream odota/parser project is designed to run as an always-on HTTP
 * server (opendota.Main, port 5600) that receives a replay as a POST body.
 * Running an HTTP server inside a single-invocation AWS Lambda container adds
 * unnecessary complexity, so this wrapper invokes the same Parse class
 * directly against a local file and streams line-delimited JSON match
 * events to stdout, matching the documented output format of the parser
 * (https://github.com/odota/parser).
 *
 * Usage:
 *   java -cp parser.jar opendota.FileParse <path-to-replay.dem>
 *
 * Exit codes:
 *   0  - parsing completed and at least one event was emitted
 *   1  - usage error (missing/invalid argument)
 *   2  - parsing failed (exception thrown while reading the replay)
 */
public class FileParse {
    public static void main(String[] args) {
        if (args.length < 1) {
            System.err.println("usage: FileParse <path-to-replay.dem>");
            System.exit(1);
        }

        String replayPath = args[0];

        try (InputStream is = new FileInputStream(replayPath);
             OutputStream os = System.out) {
            // blob=false -> line-delimited JSON events on stdout, one per line,
            // matching the default (non-blob) output mode of the upstream parser.
            new Parse(is, os, false);
            os.flush();
        } catch (Exception e) {
            e.printStackTrace();
            System.exit(2);
        }
    }
}
