output "backend_configuration" {
  description = "Non-secret backend values for infrastructure/scaleway/backend.hcl."
  value = {
    bucket = scaleway_object_bucket.terraform_state.name
    key    = "evorto/platform.tfstate"
    region = var.region
    endpoints = {
      s3 = "https://s3.${var.region}.scw.cloud"
    }
  }
}
