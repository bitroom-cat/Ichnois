import time
from pathlib import Path
from ichnoscope.github_app import GitHubAppService

def test_github_app_service_key_discovery_and_jwt():
    svc = GitHubAppService(app_id="123456")
    key_bytes = svc._get_private_key_bytes()
    assert b"BEGIN RSA PRIVATE KEY" in key_bytes or b"BEGIN PRIVATE KEY" in key_bytes
    
    # Generate RS256 JWT
    token = svc.create_app_jwt(expire_seconds=300)
    assert isinstance(token, str)
    assert len(token) > 100
    
    # Token parts check
    parts = token.split(".")
    assert len(parts) == 3
