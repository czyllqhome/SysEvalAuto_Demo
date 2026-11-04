"""Local startup configuration must not leak secrets or import deployment settings."""

from app import local


def test_local_env_reads_model_settings_without_importing_compose_configuration(tmp_path):
    path = tmp_path / ".env"
    path.write_text(
        '\ufeffOPENROUTER_API_KEY="synthetic-test-key"\n'
        'export OPENROUTER_MODEL=test/structured-model # model selection\n'
        "OPENROUTER_PROVIDERS='provider-a,provider-b'\n"
        'OPENROUTER_ZDR=true\n'
        'OPENROUTER_REASONING_TOKENS=2048\n'
        'SYSEVAL_DATABASE_URL=postgresql://test@db:5432/test\n'
        'SYSEVAL_EMBEDDED_WORKER=false\n'
        'SYSEVAL_AUTO_CREATE=false\n', encoding="utf-8",
    )
    environment = {}
    local.load_model_settings(path, environment)
    assert environment == {
        "OPENROUTER_API_KEY": "synthetic-test-key", "OPENROUTER_MODEL": "test/structured-model",
        "OPENROUTER_PROVIDERS": "provider-a,provider-b", "OPENROUTER_ZDR": "true",
        "OPENROUTER_REASONING_TOKENS": "2048",
    }


def test_process_settings_take_precedence_and_values_are_not_interpolated(tmp_path):
    path = tmp_path / ".env"
    path.write_text('OPENROUTER_API_KEY=file-key\nOPENROUTER_MODEL="test/${KEEP_LITERAL}"\n', encoding="utf-8")
    environment = {"OPENROUTER_API_KEY": "process-key"}
    local.load_model_settings(path, environment)
    assert environment == {"OPENROUTER_API_KEY": "process-key", "OPENROUTER_MODEL": "test/${KEEP_LITERAL}"}


def test_absent_local_file_leaves_process_environment_unchanged(tmp_path):
    environment = {"OPENROUTER_API_KEY": "process-key"}
    local.load_model_settings(tmp_path / ".env", environment)
    assert environment == {"OPENROUTER_API_KEY": "process-key"}
    assert not (tmp_path / ".env").exists()


def test_startup_loads_before_serving_and_prints_no_secrets(tmp_path, monkeypatch, capsys):
    (tmp_path / ".env").write_text('OPENROUTER_API_KEY=synthetic-private-key\nOPENROUTER_MODEL=test/model\n', encoding="utf-8")
    monkeypatch.setattr(local, "ROOT", tmp_path)
    for key in local.MODEL_SETTINGS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SYSEVAL_PORT", "8123")
    calls = []
    monkeypatch.setattr(local.uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    # Register the environment changes so monkeypatch restores them after this test.
    for key in local.MODEL_SETTINGS:
        monkeypatch.setenv(key, "")
        monkeypatch.delenv(key)
    local.main()
    assert local.os.environ["OPENROUTER_API_KEY"] == "synthetic-private-key"
    assert calls == [(("app.main:app",), {"host": "127.0.0.1", "port": 8123})]
    assert capsys.readouterr().out == "OpenRouter: configured\n"
