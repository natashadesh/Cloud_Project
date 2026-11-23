# Job API Lambda, IAM permissions, logs and API Gateway routes, CORS and invocation access.

# Existing DynamoDB table created by shared Terraform
data "aws_dynamodb_table" "jobs" {
  name = "cloud-project-jobs"
}

# Use the existing AWS Academy LabRole
data "aws_iam_role" "lab_role" {
  name = "LabRole"
}

# Deploy the Job API Lambda function
resource "aws_lambda_function" "job_api" {
  function_name = "cloud-project-job-api"
  role          = data.aws_iam_role.lab_role.arn

  filename         = "${path.module}/../../lambda/job-api/job-api.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/job-api/job-api.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"

  timeout     = 10
  memory_size = 256

  environment {
    variables = {
      JOBS_TABLE_NAME = data.aws_dynamodb_table.jobs.name

      # Tanishq's API-check Lambda
      API_CHECK_FUNCTION_NAME = local.api_check_enabled ? aws_lambda_function.api_check[0].function_name : ""

      # Bhavan's static-analysis Lambda (empty until the image digest is set)
      ANALYSIS_FUNCTION_NAME = local.analysis_enabled ? aws_lambda_function.analysis[0].function_name : ""

      # Bhavan's private artifacts bucket (upload forms, upload checks, report links)
      ARTIFACTS_BUCKET_NAME = local.artifacts_bucket_name

      # Allow new jobs to be created and started
      ALLOW_NEW_JOBS = "true"
    }
  }

}


# CloudWatch logs for the Job API Lambda
resource "aws_cloudwatch_log_group" "job_api" {
  name              = "/aws/lambda/cloud-project-job-api"
  retention_in_days = 7
}


# HTTP API Gateway for Job API
resource "aws_apigatewayv2_api" "job_api" {
  name          = "cloud-project-job-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [
      "http://cloud-project-website-807928980637.s3-website-us-east-1.amazonaws.com"
    ]

    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type"]
  }
}

# Connect API Gateway to Lambda
resource "aws_apigatewayv2_integration" "job_api" {
  api_id                 = aws_apigatewayv2_api.job_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.job_api.invoke_arn
  payload_format_version = "2.0"
}

# POST /jobs endpoint
resource "aws_apigatewayv2_route" "create_job" {
  api_id    = aws_apigatewayv2_api.job_api.id
  route_key = "POST /jobs"
  target    = "integrations/${aws_apigatewayv2_integration.job_api.id}"
}

# GET /jobs/{jobId} endpoint
resource "aws_apigatewayv2_route" "get_job" {
  api_id    = aws_apigatewayv2_api.job_api.id
  route_key = "GET /jobs/{jobId}"
  target    = "integrations/${aws_apigatewayv2_integration.job_api.id}"
}

# POST /jobs/{jobId}/start endpoint
resource "aws_apigatewayv2_route" "start_job" {
  api_id    = aws_apigatewayv2_api.job_api.id
  route_key = "POST /jobs/{jobId}/start"
  target    = "integrations/${aws_apigatewayv2_integration.job_api.id}"
}

# GET /jobs/{jobId}/report endpoint
resource "aws_apigatewayv2_route" "get_report" {
  api_id    = aws_apigatewayv2_api.job_api.id
  route_key = "GET /jobs/{jobId}/report"
  target    = "integrations/${aws_apigatewayv2_integration.job_api.id}"
}


# Automatically deploy API changes and limit request rates
resource "aws_apigatewayv2_stage" "job_api" {
  api_id      = aws_apigatewayv2_api.job_api.id
  name        = "$default"
  auto_deploy = true

  # Default throttling for all API routes
  default_route_settings {
    throttling_rate_limit  = 5
    throttling_burst_limit = 10
  }

  # Stricter throttling for creating jobs
  route_settings {
    route_key              = "POST /jobs"
    throttling_rate_limit  = 1
    throttling_burst_limit = 2
  }

  # Stricter throttling for starting jobs
  route_settings {
    route_key              = "POST /jobs/{jobId}/start"
    throttling_rate_limit  = 1
    throttling_burst_limit = 2
  }
  depends_on = [
    aws_apigatewayv2_route.create_job,
    aws_apigatewayv2_route.get_job,
    aws_apigatewayv2_route.start_job,
    aws_apigatewayv2_route.get_report
  ]
}


# Allow API Gateway to invoke Lambda
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.job_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.job_api.execution_arn}/*/*"
}
