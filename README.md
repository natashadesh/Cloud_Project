# Cloud Security Platform

JavaScript SAST scanner, API penetration tester, and Terraform infrastructure.

## Setup

Install [Node.js 24](https://nodejs.org/en/download) and npm. From the repository
root, install the scanner dependencies:

```sh
npm run install:deps
```

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

- `terraform/shared/` contains infrastructure intended for multiple app components.
  It currently creates the on-demand DynamoDB table `tf-template`, with a string
  `id` partition key. The ECR and S3 files are placeholders.
- `terraform/apps/` is intended for the Lambdas, API Gateway, and frontend assets.
  Its files are currently placeholders and do not create app resources.

Each developer uses local Terraform state in their own AWS lab. From the
repository root, initialize and check the shared configuration, then review the
plan before applying:

```sh
npm run terraform:shared -- init
npm run terraform:shared -- validate
npm run terraform:shared -- plan
npm run terraform:shared -- apply
npm run terraform:shared -- output
```

When finished, destroy resources you created. If both configurations contain
resources, destroy apps before shared:

```sh
npm run terraform:apps -- destroy
npm run terraform:shared -- destroy
```

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
