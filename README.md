# Cloud Security Platform

JavaScript SAST scanner, API penetration tester, and Terraform infrastructure.

## Setup

Install [Node.js 24](https://nodejs.org/en/download) and npm. From the repository
root, install all project dependencies (root build tools, scanners, and Job API):

```sh
npm run install:deps
```

Run this initial setup again when a package's dependencies or lockfile change.

## Run the local apps

Run each command in a separate terminal:

```sh
npm run start:sast                  # localhost:3000
PORT=3001 npm run start:pentest      # localhost:3001
npm run start:target                # localhost:4000 (vulnerable test API)
```

Use `npm run dev:sast` or `npm run dev:pentest` for watch mode. API docs:
[SAST](sast/backend/Readme.md) · [Pentest](pentest/backend/Readme.Md).

## AWS credentials

Install [Terraform 1.5+](https://developer.hashicorp.com/terraform/install) and
[AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
Start your AWS Academy lab, copy the full **AWS Details → AWS CLI** credentials
block, and run this command from the repository root on macOS:

```sh
npm run aws:credentials
```

The script reads the block from your clipboard, verifies the credentials, and
saves them in `~/.aws/credentials`. Never commit credentials.

## Terraform

Terraform is split into two configurations:

- `terraform/shared/` creates DynamoDB, ECR repositories, and S3 buckets.
- `terraform/apps/` deploys the Job API, API-check worker, API Gateway, and
  frontend files. The SAST worker's Terraform is still a placeholder.

Install [Docker Desktop](https://docs.docker.com/desktop/) with Buildx in addition
to the tools above. Image preparation requires Bash (macOS, Linux, or WSL).

After a destroy, start Docker Desktop and your AWS Academy lab. Copy the current
**AWS Details → AWS CLI** credentials block, then run from the repository root:

```sh
npm run aws:credentials
terraform -chdir=terraform/shared init
terraform -chdir=terraform/shared apply
npm run prepare:apps
terraform -chdir=terraform/apps init
terraform -chdir=terraform/apps apply
```

On a fresh checkout or when dependencies change, first run `npm run install:deps`.
A Terraform destroy does not remove installed dependencies. You can skip `init`
when that Terraform directory is already initialized.

You run both applies yourself. Shared infrastructure must be applied first,
because the image needs an ECR repository to be uploaded into.

`npm run prepare:apps` builds the Job API ZIP, builds and pushes Tanishq's
API-check image, and retrieves its digest. It saves the region and digest in
`terraform/apps/image.auto.tfvars.json`, which is excluded from Git. Terraform
loads that file automatically when you run apps `plan` or `apply`. The script
never runs Terraform apply.

Review the Terraform plans and type `yes` when prompted. The apps outputs include
`website_url` and `api_url`. Preparation rebuilds the ZIP each time and uses
Docker's normal layer cache. If preparation fails, fix the error and rerun it
before applying apps.

For working API checks, supply your test API's actual base URL, reachable from
AWS Lambda, when preparing:

```sh
API_CHECK_TARGET_URL="https://your-test-api.example" npm run prepare:apps
```

Replace the example address. A supplied target is saved in the generated
variables file and retained on later preparations. Without a configured target,
the existing default is `http://localhost:4000`, which cannot reach the test
server on your laptop from AWS.

The default region is `us-east-1`. To use another region, set `TF_VAR_aws_region`
before running shared Terraform and preparation so both use the same region.

For later app changes, run `npm run prepare:apps`, then
`terraform -chdir=terraform/apps apply`. To build only the ZIP locally, use
`npm run build:job-api`.

The `terraform:shared` and `terraform:apps` npm commands run Terraform directly;
validation, output, and destroy do not build the ZIP. Keep the generated variables
file for later apps plans/applies; without an image digest, Terraform disables
the API-check worker. Each fresh checkout needs its own preparation.

To inspect deployed URLs:

```sh
terraform -chdir=terraform/apps output
```

When finished, destroy apps before shared:

```sh
terraform -chdir=terraform/apps destroy
terraform -chdir=terraform/shared destroy
```

The website and artifacts buckets are created or reused through the AWS CLI for
Learner Lab compatibility. Terraform destroy leaves those buckets and their
contents in place; a later deployment reuses them.

Keep local state files until cleanup is complete. `.gitignore` excludes Terraform
state, generated files, local credentials, and dependency folders.

## Team Git workflow

Start with a clean working tree. Update `main`, then create a branch for your task:

```sh
git switch main
git pull origin main
git switch -c <your-branch-name>
```

Replace `<your-branch-name>` with your branch name. Follow the setup and Terraform
steps above. After cleanup, commit and push your changes:

```sh
git add <files-you-changed>
git commit -m "Describe your change"
git push -u origin <your-branch-name>
```

Open a pull request into `main`. Merge after at least two teammates approve.

[Architecture proposal](docs/ARCHITECTURE.md).
