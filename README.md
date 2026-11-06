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

- `terraform/shared/` contains infrastructure intended for multiple app components.
  It currently creates the on-demand DynamoDB table `tf-template`, with a string
  `id` partition key. The ECR and S3 files are placeholders.
- `terraform/apps/` is intended for the Lambdas, API Gateway, and frontend assets.
  It currently deploys the Job API Lambda and its HTTP API Gateway.

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

For the Job API, run the initial dependency setup above, then use these commands
from the repository root on macOS, Linux, or Windows:

```sh
npm run terraform:apps -- init
npm run terraform:apps -- plan
npm run terraform:apps -- apply
```

Every `terraform:apps` command first builds `lambda/job-api/job-api.zip`,
including `init`, `validate`, `output`, and `destroy`. The build
uses `bestzip`'s Node.js implementation to recreate the ZIP with `index.js`,
`package.json`, and the installed production `node_modules/` at the archive root.
It does not install dependencies or require a system `zip` command. A failed
build stops Terraform, and existing ZIPs are excluded from the package. Archive
timestamps are not normalized, so unchanged code may produce a different ZIP
hash on rebuild.

To build the archive independently, run `npm run build:job-api`.

To save a plan for review, build once and apply with Terraform directly so the
archive is not rebuilt between plan and apply:

```sh
npm run terraform:apps -- plan -out=apps.tfplan
terraform -chdir=terraform/apps apply apps.tfplan
```

Keep the exact generated ZIP and saved plan together until apply completes.
The plan file above is saved in `terraform/apps/` because Terraform uses `-chdir`.

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
