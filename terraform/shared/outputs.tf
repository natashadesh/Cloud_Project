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
