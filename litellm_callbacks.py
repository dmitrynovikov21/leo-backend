"""
Custom LiteLLM callback for logging usage to LEO Gateway webhook.
This callback sends token usage, cost, and metadata via HTTP POST.
"""
import os
import httpx
import sys
import json
from datetime import datetime
from typing import Optional, Any
from litellm.integrations.custom_logger import CustomLogger


class PostgresUsageLogger(CustomLogger):
    """
    LiteLLM callback that sends all LLM request metrics to LEO Gateway webhook.
    """
    
    def __init__(self):
        sys.stderr.write("[PostgresUsageLogger] Initializing PostgresUsageLogger...\n")
        self.webhook_url = os.environ.get("LEO_WEBHOOK_URL", "http://leo-gateway:8080/api/v1/llm-webhook")
        self.enabled = bool(os.environ.get("LEO_WEBHOOK_URL") or os.environ.get("LEO_DATABASE_URL"))
        if not self.enabled:
            sys.stderr.write("[PostgresUsageLogger] Warning: LEO_WEBHOOK_URL not set, usage logging disabled\n")
        else:
            sys.stderr.write(f"[PostgresUsageLogger] Enabled. Webhook URL: {self.webhook_url}\n")

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        """Async version of log_success_event"""
        self.log_success_event(kwargs, response_obj, start_time, end_time)

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        """Async version of log_failure_event"""
        pass
    
    def _extract_user_id(self, kwargs: dict, response_obj: Any) -> str:
        """Extract user_id from request metadata."""
        metadata = kwargs.get("litellm_params", {}).get("metadata", {})
        user_id = metadata.get("user_id") or metadata.get("userId")
        
        if not user_id:
            user_id = kwargs.get("user")
        
        return user_id or "unknown"
    
    def _extract_agent_id(self, kwargs: dict) -> Optional[str]:
        """Extract agent_id from request metadata."""
        metadata = kwargs.get("litellm_params", {}).get("metadata", {})
        return metadata.get("agent_id") or metadata.get("agentId")
    
    def _extract_request_type(self, kwargs: dict) -> str:
        """Extract request_type from request metadata."""
        metadata = kwargs.get("litellm_params", {}).get("metadata", {})
        request_type = metadata.get("request_type") or metadata.get("requestType")
        
        valid_types = ['AGENT_CHAT', 'DOCUMENT_PROCESSING', 'QUIZ_GENERATION', 
                       'PROMPT_GENERATION', 'SUMMARIZATION', 'OTHER']
        if request_type in valid_types:
            return request_type
        return "OTHER"
    
    def _extract_is_test(self, kwargs: dict) -> bool:
        """Extract is_test flag from request metadata."""
        metadata = kwargs.get("litellm_params", {}).get("metadata", {})
        return bool(metadata.get("is_test") or metadata.get("isTest", False))
    
    def _calculate_platform_tokens(self, total_tokens: int, cost_usd: float) -> float:
        """
        Calculate platform tokens to charge based on cost.
        Default: 1 USD = 1000 platform tokens with 2x markup
        """
        metadata_multiplier = 2.0
        tokens_per_usd = 1000
        return cost_usd * metadata_multiplier * tokens_per_usd
    
    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        """Called when LLM request succeeds."""
        if not self.enabled:
            return
            
        try:
            usage = response_obj.get("usage", {}) if isinstance(response_obj, dict) else getattr(response_obj, "usage", None)
            
            if not usage:
                return
            
            prompt_tokens = getattr(usage, "prompt_tokens", 0) if hasattr(usage, "prompt_tokens") else usage.get("prompt_tokens", 0)
            completion_tokens = getattr(usage, "completion_tokens", 0) if hasattr(usage, "completion_tokens") else usage.get("completion_tokens", 0)
            total_tokens = getattr(usage, "total_tokens", 0) if hasattr(usage, "total_tokens") else usage.get("total_tokens", 0)
            
            model = kwargs.get("model", "unknown")
            response_time_ms = int((end_time - start_time).total_seconds() * 1000)
            response_cost = kwargs.get("response_cost", 0) or 0
            
            user_id = self._extract_user_id(kwargs, response_obj)
            agent_id = self._extract_agent_id(kwargs)
            request_type = self._extract_request_type(kwargs)
            is_test = self._extract_is_test(kwargs)
            platform_tokens_charged = self._calculate_platform_tokens(total_tokens, response_cost)
            
            # Send to webhook
            payload = {
                "userId": user_id,
                "agentId": agent_id,
                "promptTokens": prompt_tokens,
                "completionTokens": completion_tokens,
                "totalTokens": total_tokens,
                "model": model,
                "costUsd": response_cost,
                "responseTimeMs": response_time_ms,
                "requestType": request_type,
                "platformTokensCharged": platform_tokens_charged,
                "isTest": is_test,
            }
            
            # Use sys.stderr for better visibility in docker logs
            # sys.stderr.write(f"[PostgresUsageLogger] Sending payload: {payload}\n")
            
            with httpx.Client(timeout=5.0) as client:
                response = client.post(self.webhook_url, json=payload)
                if response.status_code >= 400:
                    sys.stderr.write(f"[PostgresUsageLogger] Webhook error {response.status_code}: {response.text}\n")
            
        except Exception as e:
            sys.stderr.write(f"[PostgresUsageLogger] Error sending usage: {e}\n")
    
    def log_failure_event(self, kwargs, response_obj, start_time, end_time):
        """Called when LLM request fails. We don't charge for failures."""
        pass


# Create singleton instance for LiteLLM to use
postgres_usage_logger = PostgresUsageLogger()
