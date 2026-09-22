# `cm service`

Manage the one optional per-user loopback graph service.

```bash
cm service install
cm service start
cm service status
cm service restart
cm service stop
cm service run --port 4804
```

The service serves multiple registered projects while keeping graph, memory,
provider, and chat context project-isolated.
