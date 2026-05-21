#!/usr/bin/env python3

import threading
import time
from typing import Dict

from rclpy.impl.rcutils_logger import RcutilsLogger


class DebugLogger:

    def __init__(
            self,
            enabled: bool = True,
    ) -> None:

        self.enabled = enabled

        self._last_log_ns_by_key: Dict[str, int] = {}

        self._lock = threading.Lock()

    def info(
            self,
            logger: RcutilsLogger,
            message: str,
    ) -> None:

        if not self.enabled:
            return

        logger.info(message)

    def warn(
            self,
            logger: RcutilsLogger,
            message: str,
    ) -> None:

        if not self.enabled:
            return

        logger.warn(message)

    def error(
            self,
            logger: RcutilsLogger,
            message: str,
    ) -> None:

        if not self.enabled:
            return

        logger.error(message)

    def throttled_info(
            self,
            logger: RcutilsLogger,
            key: str,
            throttle_sec: float,
            message: str,
    ) -> None:

        if not self.enabled:
            return

        if self._should_log(
                key=key,
                throttle_sec=throttle_sec,
        ):
            logger.info(message)

    def throttled_warn(
            self,
            logger: RcutilsLogger,
            key: str,
            throttle_sec: float,
            message: str,
    ) -> None:

        if not self.enabled:
            return

        if self._should_log(
                key=key,
                throttle_sec=throttle_sec,
        ):
            logger.warn(message)

    @staticmethod
    def every_n(
            counter: int,
            n: int,
    ) -> bool:

        if n <= 0:
            return True

        return counter % n == 0

    def _should_log(
            self,
            key: str,
            throttle_sec: float,
    ) -> bool:

        now_ns = time.monotonic_ns()

        throttle_ns = int(
            throttle_sec * 1e9
        )

        with self._lock:

            last_ns = self._last_log_ns_by_key.get(key)

            if last_ns is None:
                self._last_log_ns_by_key[key] = now_ns
                return True

            if now_ns - last_ns >= throttle_ns:
                self._last_log_ns_by_key[key] = now_ns
                return True

        return False