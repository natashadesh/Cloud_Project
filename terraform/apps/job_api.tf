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
    }
  }
}

# HTTP API Gateway for Job API
resource "aws_apigatewayv2_api" "job_api" {
  name          = "cloud-project-job-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
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

# Automatically deploy API changes
resource "aws_apigatewayv2_stage" "job_api" {
  api_id      = aws_apigatewayv2_api.job_api.id
  name        = "$default"
  auto_deploy = true
}

# Allow API Gateway to invoke Lambda
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.job_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.job_api.execution_arn}/*/*"
}