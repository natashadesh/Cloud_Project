# ECR repositories for SAST and pentest images, access policies and image cleanup.

# API-check (pentest) worker image. Push it before applying apps, which creates the Lambda.
resource "aws_ecr_repository" "api_check" {
  name                 = "cloud-project-api-check"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Let only this account's Lambda service pull the image.
resource "aws_ecr_repository_policy" "api_check" {
  repository = aws_ecr_repository.api_check.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "LambdaImageRetrieval"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
      Condition = {
        StringLike = {
          "aws:sourceArn" = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:*"
        }
      }
    }]
  })
}

# Delete untagged images (old builds) after one day.
resource "aws_ecr_lifecycle_policy" "api_check" {
  repository = aws_ecr_repository.api_check.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 1
      }
      action = { type = "expire" }
    }]
  })
}
