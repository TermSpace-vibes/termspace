function getGroupName(item) {
  if (item.metadata?.labels?.['app.kubernetes.io/name']) return item.metadata.labels['app.kubernetes.io/name']
  if (item.metadata?.labels?.app) return item.metadata.labels.app
  
  let name = item.metadata?.generateName || item.metadata?.name || 'unknown'
  // Remove trailing dash if generateName
  name = name.replace(/-$/, '')
  
  // Typical k8s deployment pod names: <deployment>-<rs-hash>-<pod-hash>
  // Let's strip the pod-hash and rs-hash if they exist.
  const parts = name.split('-')
  if (parts.length >= 3) {
    const last = parts[parts.length - 1]
    const prev = parts[parts.length - 2]
    // rs hash is typically 9-10 hex chars or alphanumeric. pod hash is 5 chars alphanumeric.
    if (last.length === 5 && prev.match(/^[a-f0-9]{8,10}$/)) {
      parts.pop()
      parts.pop()
      return parts.join('-')
    } else if (last.match(/^[a-f0-9]{8,10}$/)) { // generateName format
      parts.pop()
      return parts.join('-')
    }
  }
  return name
}

console.log(getGroupName({ metadata: { name: 'astoria-backend-5c8c697475-abcd1' } }))
console.log(getGroupName({ metadata: { generateName: 'astoria-frontend-776d47c7f9-' } }))
console.log(getGroupName({ metadata: { name: 'astoria-ping-post-f7fd59d7b-xyz12' } }))
