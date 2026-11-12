output "dynamodb_table_name" {
  description = "Name of the DynamoDB table."
  value       = aws_dynamodb_table.app.name
}

output "dynamodb_table_arn" {
  description = "ARN of the DynamoDB table."
  value       = aws_dynamodb_table.app.arn
}

output "artifacts_bucket_name" {
  description = "Name of the private artifacts bucket."
  value       = terraform_data.artifacts_bucket.output
}

output "artifacts_bucket_arn" {
  description = "ARN of the private artifacts bucket."
  value       = "arn:aws:s3:::${terraform_data.artifacts_bucket.output}"
}

output "api_check_repository_url" {
  description = "ECR repository URL for the API-check worker image."
  value       = aws_ecr_repository.api_check.repository_url
}

output "website_bucket_name" {
  description = "Name of the public website bucket."
  value       = terraform_data.website_bucket.output
}

output "website_url" {
  description = "Website address (also the origin for artifacts-bucket CORS)."
  value       = "http://${aws_s3_bucket_website_configuration.website.website_endpoint}"
}
