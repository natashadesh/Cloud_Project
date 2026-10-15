# Team contribution workflow

Start with a clean working tree. Update `main`, then create a branch for your task:

```sh
git switch main
git pull origin main
git switch -c <your-branch-name>
```

Replace `<your-branch-name>` with your branch name. Follow the setup and Terraform
steps in [`terraform_base/README.md`](terraform_base/README.md). Review the plan
before applying changes. When finished, destroy the resources you created; if you
used both Terraform configurations, destroy apps before shared resources.

Commit and push your changes. Replace the example file path, commit message, and
branch name with your own:

```sh
git add path/to/changed-file
git commit -m "Describe your change"
git push -u origin <your-branch-name>
```

Open a pull request into `main`. It will request reviews from at least two
teammates. Merge after both approve. Never commit AWS credentials or Terraform
state files.
