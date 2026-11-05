"""Detach current evidence while retaining immutable files and historical documents."""


def without_reference(value, evidence):
    if isinstance(value, str):
        canonical = f'{evidence.filename} | evidence:{evidence.id} | SHA-256:{evidence.sha256}'
        return value.replace(canonical, '').replace(f'evidence:{evidence.id}', '')
    if isinstance(value, dict):
        return {key: without_reference(item, evidence) for key, item in value.items()}
    if isinstance(value, list):
        return [without_reference(item, evidence) for item in value]
    return value
