output "control_plane_ipv4" {
  description = "Public IPv4 of the k3s control plane (point DNS / fetch the kubeconfig here)."
  value       = hcloud_server.control_plane.ipv4_address
}

output "agent_ipv4s" {
  description = "Public IPv4s of the k3s agent nodes."
  value       = hcloud_server.agent[*].ipv4_address
}

output "kubeconfig_hint" {
  description = "How to fetch the cluster kubeconfig once the control plane is up."
  value       = "ssh root@${hcloud_server.control_plane.ipv4_address} cat /etc/rancher/k3s/k3s.yaml | sed 's/127.0.0.1/${hcloud_server.control_plane.ipv4_address}/' > kubeconfig.yaml"
}
