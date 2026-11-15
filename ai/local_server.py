"""Local-only API backed by a parsed JSON fixture; never use on a public network."""
import argparse
import json
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from handler import MAX_QUESTION, INSIGHT_QUESTION, cache_key, generate, generate_insight, insight_context, match_context

parser = argparse.ArgumentParser()
parser.add_argument("fixture", help="Path to one parsed match JSON")
parser.add_argument("--port", type=int, default=8787)
args = parser.parse_args()
raw = json.loads(Path(args.fixture).read_text())
cache = {}


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send(200, {})

    def do_GET(self):
        self.handle_request("GET")

    def do_POST(self):
        self.handle_request("POST")

    def send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "http://localhost:5173")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def handle_request(self, method):
        match = re.fullmatch(r"/matches/(\d{1,20})/(details|analysis|chat|insight)", self.path)
        if not match:
            return self.send(404, {"message": "Not found."})
        try:
            data = match_context(raw, match.group(1))
            action = match.group(2)
            if method == "GET" and action == "details":
                return self.send(200, data)
            if method != "POST" or action not in ("analysis", "chat", "insight"):
                return self.send(404, {"message": "Not found."})
            length = int(self.headers.get("Content-Length", "0"))
            if length > 4096:
                raise ValueError()
            body = json.loads(self.rfile.read(length))
            if action == "insight":
                identifier = cache_key(data, -1)
                if identifier in cache:
                    return self.send(200, {"insight": cache[identifier], "cached": True})
                question = INSIGHT_QUESTION
            elif action == "analysis":
                index = body.get("player_index")
                if type(index) is not int or not 0 <= index < len(data["players"]):
                    raise ValueError()
                identifier = cache_key(data, index)
                if identifier in cache:
                    return self.send(200, {"answer": cache[identifier], "cached": True})
                question = f"Analyze the item build of player_index {index}, citing replay evidence. Distinguish purchases from completed items and usage."
            else:
                question = body.get("question")
                if not isinstance(question, str) or not 1 <= len(question.strip()) <= MAX_QUESTION:
                    raise ValueError()
            key = os.environ.get("OPENROUTER_API_KEY")
            if not key:
                return self.send(503, {"message": "Set OPENROUTER_API_KEY to enable AI analysis."})
            if action == "insight":
                insight = generate_insight(insight_context(data), key)
                cache[identifier] = insight
                return self.send(200, {"insight": insight, "cached": False})
            answer = generate(data, question, key)
            if action == "analysis":
                cache[identifier] = answer
            return self.send(200, {"answer": answer, "cached": False})
        except (ValueError, TypeError, json.JSONDecodeError):
            return self.send(400, {"message": "Invalid request or match fixture."})
        except Exception:
            return self.send(503, {"message": "AI analysis is temporarily unavailable."})


print(f"Local analysis API: http://localhost:{args.port}")
HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
