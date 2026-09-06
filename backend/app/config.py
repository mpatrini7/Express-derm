from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    data_dir: Path = Path("./data")
    max_upload_mb: int = 25
    focus_threshold: float = 80.0
    min_brightness: float = 45.0
    max_brightness: float = 220.0
    camera_mock: bool = False

    ai_enabled: bool = True
    ai_backend: str = "onnxruntime"
    ai_model_dir: Path = Path("../models/express-derm-1")
    ai_allow_unvalidated_model: bool = True
    ai_worker_socket: Path = Path("./data/express-derm-ai.sock")
    ai_worker_timeout_seconds: float = 30.0

    model_config = SettingsConfigDict(
        env_prefix="EXPRESS_DERM_",
        env_file=".env",
        extra="ignore",
    )

    @property
    def database_url(self) -> str:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{(self.data_dir / 'express_derm.db').resolve()}"

    @property
    def image_dir(self) -> Path:
        path = self.data_dir / "images"
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
