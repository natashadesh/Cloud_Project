# Deliberately vulnerable test API for the API-check worker to scan, as a small
# public Lambda (Function URL). Fake data only. The worker's TARGET_URL points here
# unless api_check_target_url is set (see pentest.tf).

locals {
  test_target_function_name = "cloud-project-test-target"
  test_target_source_dir    = "${path.module}/../../pentest/backend"
}

# Zip the two source files; they have no npm dependencies.
data "archive_file" "test_target" {
  type        = "zip"
  output_path = "${path.module}/.build/test-target.zip"

  source {
    filename = "test-target-app.js"
    content  = file("${local.test_target_source_dir}/test-target-app.js")
  }

  source {
    filename = "test-target-lambda.js"
    content  = file("${local.test_target_source_dir}/test-target-lambda.js")
  }

  # The files use ES modules (import/export).
  source {
    filename = "package.json"
    content  = jsonencode({ type = "module" })
  }
}

# Seven-day log group, created before the function so Lambda does not make its own.
resource "aws_cloudwatch_log_group" "test_target" {
  name              = "/aws/lambda/${local.test_target_function_name}"
  retention_in_days = 7
}

resource "aws_lambda_function" "test_target" {
  function_name    = local.test_target_function_name
  role             = data.aws_iam_role.lab_role.arn
  filename         = data.archive_file.test_target.output_path
  source_code_hash = data.archive_file.test_target.output_base64sha256
  handler          = "test-target-lambda.handler"
  runtime          = "nodejs22.x"

  timeout     = 5
  memory_size = 128

  depends_on = [aws_cloudwatch_log_group.test_target]
}

# Public HTTPS address, with no login, so the worker can reach it.
resource "aws_lambda_function_url" "test_target" {
  function_name      = aws_lambda_function.test_target.function_name
  authorization_type = "NONE"
}

# A public Function URL needs both permissions: calling the URL, and invoking
# the function through that URL only.
resource "aws_lambda_permission" "test_target_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.test_target.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "test_target_invoke" {
  statement_id             = "AllowPublicInvokeViaFunctionUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.test_target.function_name
  principal                = "*"
  invoked_via_function_url = true
}
