# Website and API URLs and deployed Lambda function names.

output "api_url" {
  description = "Job API base URL."
  value       = aws_apigatewayv2_stage.job_api.invoke_url
}

output "api_check_function_name" {
  description = "API-check Lambda name (null until the image digest is set)."
  value       = one(aws_lambda_function.api_check[*].function_name)
}

output "api_check_function_arn" {
  description = "API-check Lambda ARN, for the Job API to invoke."
  value       = one(aws_lambda_function.api_check[*].arn)
}

output "website_url" {
  description = "Public website address."
  value       = "http://${local.website_bucket_name}.s3-website-${var.aws_region}.amazonaws.com"
}
