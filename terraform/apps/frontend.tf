# Frontend asset uploads to the website bucket and config.json with the API endpoint.
# The bucket itself is created by terraform/shared/website.tf.

locals {
  website_bucket_name = "cloud-project-website-${data.aws_caller_identity.current.account_id}"
  frontend_dir        = "${path.module}/../../frontend"

  content_types = {
    html = "text/html; charset=utf-8"
    css  = "text/css; charset=utf-8"
    js   = "text/javascript; charset=utf-8"
    json = "application/json"
    png  = "image/png"
    svg  = "image/svg+xml"
    ico  = "image/x-icon"
  }

  # config.json is generated below, so a local copy is never uploaded.
  frontend_files = [
    for f in fileset(local.frontend_dir, "**") : f if f != "config.json"
  ]
}

resource "aws_s3_object" "frontend" {
  for_each = toset(local.frontend_files)

  bucket       = local.website_bucket_name
  key          = each.value
  source       = "${local.frontend_dir}/${each.value}"
  source_hash  = filemd5("${local.frontend_dir}/${each.value}")
  content_type = lookup(local.content_types, reverse(split(".", each.value))[0], "application/octet-stream")
}

# Tells the page where the Job API lives. No caching, so a redeploy is seen immediately.
resource "aws_s3_object" "frontend_config" {
  bucket        = local.website_bucket_name
  key           = "config.json"
  content_type  = "application/json"
  cache_control = "no-store"
  content = jsonencode({
    apiUrl = aws_apigatewayv2_stage.job_api.invoke_url
  })
}
