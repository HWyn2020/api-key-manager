# Mission

## What This Project Accomplishes

API Key Manager provides secure API key lifecycle management. It covers the full span of a key's life: generation, storage, validation, rotation, expiration, and revocation, with an immutable audit trail recording every operation.

Core capabilities:

- **Key generation** with `hg_` prefix and 384-bit cryptographic entropy
- **AES-256-GCM encryption** at rest, paired with **bcrypt hashing** for validation -- plaintext keys are never stored
- **Key rotation** with configurable grace periods for zero-downtime transitions
- **Expiration and revocation** with reason tracking and automatic status transitions
- **Per-key rate limiting** via sliding window algorithm
- **Immutable audit logging** of every lifecycle event (actor, timestamp, IP, metadata)
- **SQLite storage** in WAL mode -- single file, no external database required
- **Express REST API** exposing 9 endpoints and a **CLI** with 7 commands

## The Problem It Solves

Most API key systems fall into one of two categories: too simple or too complex.

The simple approach stores keys in plaintext, skips rotation, and has no audit trail. One database leak and every key is compromised. The complex approach requires dedicated infrastructure -- key management services, secret vaults, distributed databases -- that most teams cannot justify for API key management alone.

API Key Manager occupies the middle ground. It is a self-contained, hardened solution that delivers production-grade security (authenticated encryption, constant-time comparison, per-key rate limiting, full audit logging) without external dependencies beyond Node.js and SQLite.

## Who It Serves

- **Developers** building APIs who need key management without vendor lock-in
- **Startups** that need production-grade security from day one but cannot afford dedicated infrastructure
- **Platform teams** managing API access across multiple services or tenants
- **Security-conscious teams** that require audit trails, rotation policies, and encryption at rest as baseline requirements

## Vision

A complete, auditable, security-first API key manager that can be embedded into any Node.js project as a library or run standalone as a service. No external dependencies. No managed services. No vendor lock-in. One SQLite file, one process, full control.

The system should be simple enough to deploy in five minutes and robust enough to pass a security audit.
