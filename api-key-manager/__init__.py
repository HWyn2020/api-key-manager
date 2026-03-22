"""
API Key Manager - Secure CLI tool for managing API keys with rate limiting and expiration
"""
from .manager import APIKeyManager
from .cli import main

__version__ = "1.0.0"
__all__ = ["APIKeyManager", "main"]