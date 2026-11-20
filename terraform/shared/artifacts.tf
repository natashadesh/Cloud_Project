# Private uploads and reports bucket with versioning, encryption and cleanup.
#
# Learner Lab: an SCP denies s3:GetBucketObjectLockConfiguration, which the aws_s3_bucket
# resource reads on every create, update and refresh. Create or reuse the bucket
# with the AWS CLI, like website.tf; manage its settings with Terraform below.
# The bucket and its contents remain after terraform destroy.

# Also used by registry.tf and website.tf, so it stays in this file.
data "aws_caller_identity" "current" {}

locals {
  # Same name pattern that apps/pentest.tf builds, so it must not change.
  artifacts_bucket_name = "cloud-project-artifacts-${data.aws_caller_identity.current.account_id}"
  artifacts_bucket      = terraform_data.artifacts_bucket.output
}

resource "terraform_data" "artifacts_bucket" {
  input = local.artifacts_bucket_name

  provisioner "local-exec" {
    command = "aws s3api head-bucket --bucket ${self.input} --expected-bucket-owner ${data.aws_caller_identity.current.account_id} --region ${var.aws_region} 2>/dev/null || aws s3 mb s3://${self.input} --region ${var.aws_region}"
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = local.artifacts_bucket
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = local.artifacts_bucket

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = local.artifacts_bucket

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = local.artifacts_bucket

  # Lifecycle rules on a versioned bucket must wait for versioning to be enabled.
  depends_on = [aws_s3_bucket_versioning.artifacts]

  rule {
    id     = "inputs"
    status = "Enabled"

    filter {
      prefix = "inputs/"
    }

    expiration {
      days = 1
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "reports"
    status = "Enabled"

    filter {
      prefix = "reports/"
    }

    expiration {
      days = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "cleanup"
    status = "Enabled"

    filter {}

    expiration {
      expired_object_delete_marker = true
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Browser uploads (presigned POST) and report fetches (GET) are allowed only from the website.
resource "aws_s3_bucket_cors_configuration" "artifacts" {
  bucket = local.artifacts_bucket

  cors_rule {
    allowed_methods = ["POST", "GET"]
    allowed_origins = ["http://${aws_s3_bucket_website_configuration.website.website_endpoint}"]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}
