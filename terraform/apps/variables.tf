variable "aws_region" {
  description = "AWS region for this lab."
  type        = string
  default     = "us-east-1"
}

variable "api_check_image_digest" {
  description = "Digest (sha256:...) of the pushed API-check image. Leave null to skip creating the Lambda."
  type        = string
  default     = null
}

variable "api_check_target_url" {
  description = "Base URL of the test API the API-check worker scans."
  type        = string
  default     = "http://localhost:4000"
}
