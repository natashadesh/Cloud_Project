# Website S3 bucket, static website hosting and public read policy.
# Same Learner Lab workaround as artifacts.tf: the empty bucket is created with the
# AWS CLI, and its settings are normal Terraform resources. The files themselves are
# uploaded by terraform/apps/frontend.tf.

locals {
  website_bucket_name = "cloud-project-website-${data.aws_caller_identity.current.account_id}"
}

resource "terraform_data" "website_bucket" {
  input = local.website_bucket_name

  provisioner "local-exec" {
    command = "aws s3api head-bucket --bucket ${self.input} --region ${var.aws_region} 2>/dev/null || aws s3 mb s3://${self.input} --region ${var.aws_region}"
  }
}

# The website must be publicly readable, so allow a public bucket policy.
resource "aws_s3_bucket_public_access_block" "website" {
  bucket                  = terraform_data.website_bucket.output
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_website_configuration" "website" {
  bucket = terraform_data.website_bucket.output

  index_document {
    suffix = "index.html"
  }
}

# Anyone may read (GET) the website files. Nothing else is public.
resource "aws_s3_bucket_policy" "website" {
  bucket     = terraform_data.website_bucket.output
  depends_on = [aws_s3_bucket_public_access_block.website]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadWebsite"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "arn:aws:s3:::${terraform_data.website_bucket.output}/*"
    }]
  })
}
