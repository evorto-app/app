resource "scaleway_object_bucket" "terraform_state" {
  project_id    = var.project_id
  region        = var.region
  name          = var.state_bucket_name
  force_destroy = false

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "scaleway_object_bucket_acl" "terraform_state" {
  project_id = var.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.terraform_state.name
  acl        = "private"
}

resource "scaleway_object_bucket_server_side_encryption_configuration" "terraform_state" {
  project_id = var.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.terraform_state.name

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
