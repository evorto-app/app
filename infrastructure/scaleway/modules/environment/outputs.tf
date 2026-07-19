output "application_bucket" {
  value = scaleway_object_bucket.application.name
}

output "deployment_metadata_bucket" {
  value = scaleway_object_bucket.deployment_metadata.name
}

output "registry_endpoint" {
  value = scaleway_registry_namespace.application.endpoint
}

output "database" {
  value = {
    certificate   = scaleway_rdb_instance.application.certificate
    database_name = scaleway_rdb_database.application.name
    host          = scaleway_rdb_instance.application.private_network[0].ip
    port          = scaleway_rdb_instance.application.private_network[0].port
    runtime_user  = scaleway_rdb_user.runtime.name
    schema_user   = scaleway_rdb_instance.application.user_name
  }
  sensitive = true
}

output "containers" {
  value = {
    ops = {
      endpoint              = scaleway_container.ops.public_endpoint
      environment_variables = local.ops_environment_variables
      id                    = scaleway_container.ops.id
    }
    web = {
      endpoint              = scaleway_container.web.public_endpoint
      environment_variables = local.web_environment_variables
      generated_hostname    = trimsuffix(trimprefix(scaleway_container.web.public_endpoint, "https://"), "/")
      id                    = scaleway_container.web.id
    }
    worker = {
      endpoint              = scaleway_container.worker.public_endpoint
      environment_variables = local.worker_environment_variables
      id                    = scaleway_container.worker.id
    }
  }
}

output "role_application_ids" {
  value = {
    ops    = scaleway_iam_application.ops.id
    web    = scaleway_iam_application.web.id
    worker = scaleway_iam_application.worker.id
  }
}

output "role_secret_ids" {
  value = {
    for key, secret in scaleway_secret.role : key => trimprefix(secret.id, "${var.region}/")
  }
}

output "cockpit" {
  value = {
    traces_push = scaleway_cockpit_source.traces.push_url
    traces_url  = scaleway_cockpit_source.traces.url
  }
}
