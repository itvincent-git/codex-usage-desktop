# Runs inside the selected distribution. Credentials travel only over stdin/stdout.
import fcntl
import json
import os
import pathlib
import sys
import tempfile
import time
import tomllib


def snapshot(home):
    paths = [home / "config.toml", pathlib.Path("/etc/codex/config.toml")]
    for p in [home / "managed_config.toml", home / "requirements.toml",
              pathlib.Path("/etc/codex/managed_config.toml"), pathlib.Path("/etc/codex/requirements.toml")]:
        if p.exists():
            raise ValueError("accountBackendUnsupported")
    config = [p.read_text() if p.exists() else "" for p in paths]

    def validate(value, root=True):
        for key, item in value.items():
            if key == "cli_auth_credentials_store" and (not root or item != "file"):
                raise ValueError("accountBackendUnsupported")
            if key == "forced_login_method" and (not root or item not in ("chatgpt", "api")):
                raise ValueError("accountBackendUnsupported")
            if key in ("profile", "auth_mode", "chatgpt_base_url"):
                raise ValueError("accountBackendUnsupported")
            if isinstance(item, dict):
                validate(item, False)
    for doc in config:
        validate(tomllib.loads(doc))
    original = home / "auth.json"
    path = original.resolve(strict=original.is_symlink() or original.exists())
    config_path = (home / "config.toml").resolve(strict=(home / "config.toml").is_symlink())
    return {"userConfig": config[0], "configPath": str(config_path), "config": json.dumps(config, separators=(",", ":")), "path": str(path),
            "content": path.read_text() if path.exists() else None}


def lock(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    deadline = time.monotonic() + 5
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(fd)
                raise ValueError("accountLockUnavailable")
            time.sleep(.01)


def atomic_write(path, text):
    fd, name = tempfile.mkstemp(prefix=".credentials-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


try:
    request = json.load(sys.stdin)
    home = pathlib.Path(request["home"])
    current = snapshot(home)
    if request["operation"] == "commit":
        home.mkdir(mode=0o700, parents=True, exist_ok=True)
        outer = lock(home / "auth.lock")
        inner = lock(current["path"] + ".lock")
        config_lock = lock(current["configPath"] + ".lock") if request.get("targetConfig") is not None else None
        current = snapshot(home)
        if any(current[key] != request[key] for key in ("config", "path", "configPath")) or current["content"] != request["expected"]:
            raise ValueError("accountAuthConflict")
        path = pathlib.Path(current["path"])
        atomic_write(path, request["target"])
        if request.get("targetConfig") is not None:
            atomic_write(pathlib.Path(current["configPath"]), request["targetConfig"])
        if (path.read_text() != request["target"] or
                request.get("targetConfig") is not None and pathlib.Path(current["configPath"]).read_text() != request["targetConfig"]):
            raise ValueError("accountAuthConflict")
        current = {"ok": True}
    print(json.dumps(current))
except Exception as error:
    code = str(error) if isinstance(error, ValueError) and str(error).startswith("account") else "accountWslToolsRequired"
    print(json.dumps({"error": code}))
    sys.exit(1)
