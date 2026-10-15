# Cloud Security Platform

JavaScript SAST scanner, API penetration tester, and Terraform infrastructure layout.

## Setup

Install [Node.js 24](https://nodejs.org/en/download) with npm (`nvm install && nvm use`
if you use nvm), then run from the repository root:

```sh
npm run install:deps
```

## Local apps
# New cool change

Run each command in a separate terminal:

```sh
npm run start:sast                  # localhost:3000
PORT=3001 npm run start:pentest      # localhost:3001
npm run start:target                # localhost:4000 (vulnerable test API)
```

Use `dev:sast` or `dev:pentest` for watch mode. Both scanners default to port 3000;
the `PORT` override above lets them run together.

API docs: [SAST](sast/backend/Readme.md) · [Pentest](pentest/backend/Readme.Md).

## AWS

Install [Terraform 1.5+](https://developer.hashicorp.com/terraform/install) and
[AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
Start your AWS Academy lab and copy the full **AWS Details → AWS CLI** credentials
block. On macOS, import it from your clipboard:

```sh
npm run aws:credentials
```

Credentials are verified before updating `[default]` in `~/.aws/credentials`.

Terraform layout:

- `terraform/shared/`: ECR repositories, DynamoDB and S3 buckets.
- `terraform/apps/`: Lambdas, API Gateway and frontend assets.

CLI entry points: `npm run terraform:shared -- <command>` and
`npm run terraform:apps -- <command>`. Each developer will use local state in
their own lab: create shared resources → build/push images → create apps;
destroy apps before shared resources. The shared configuration currently defines
one on-demand DynamoDB table (`tf-template`) with a string `id` partition key.
Other resources remain description-only stubs.

From the repository root, after importing AWS credentials:

```sh
npm run terraform:shared -- init      # Download providers (first run)
npm run terraform:shared -- validate  # Check configuration
npm run terraform:shared -- plan      # Preview changes
npm run terraform:shared -- apply     # Create or update resources
npm run terraform:shared -- output    # Show table name and ARN
```

When finished, remove the resources:

```sh
npm run terraform:shared -- destroy
```

Use `terraform:apps` instead of `terraform:shared` for the apps configuration.
Keep local state files until cleanup is complete.

[Architecture proposal](docs/ARCHITECTURE.md).
