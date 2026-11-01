# Private uploads and reports bucket with versioning, encryption and cleanup.
# CORS is added once the website bucket (website.tf) exists, since it needs its exact origin.
#
# Learner Lab: an SCP denies s3:GetBucketObjectLockConfiguration, which the aws_s3_bucket
# resource reads on every create, update and refresh. So the empty bucket is created with
# the AWS CLI below, and all of its settings are normal Terraform resources.

data "aws_caller_identity" "current" {}

locals {
  artifacts_bucket_name = "cloud-project-artifacts-${data.aws_caller_identity.current.account_id}"
}

resource "terraform_data" "artifacts_bucket" {
  input = local.artifacts_bucket_name

  provisioner "local-exec" {
    command = "aws s3api head-bucket --bucket ${self.input} --region ${var.aws_region} 2>/dev/null || aws s3 mb s3://${self.input} --region ${var.aws_region}"
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = terraform_data.artifacts_bucket.output
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = terraform_data.artifacts_bucket.output

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = terraform_data.artifacts_bucket.output

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = terraform_data.artifacts_bucket.output

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