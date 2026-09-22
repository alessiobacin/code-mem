# Code-Mem command cheat sheets

Each page is a short English reference for one command. Run `cm help --full`
for the live surface installed in the current bundle.

## Core lifecycle and memory

- [`init`](init.md) · [`setup`](setup.md) · [`update`](update.md) · [`version`](version.md)
- [`help`](help.md) · [`graph`](graph.md)
- [`save`](save.md) · [`add`](add.md) · [`add-user`](add-user.md) · [`replace`](replace.md)
- [`rm`](rm.md) · [`archive`](archive.md) · [`touch`](touch.md) · [`link`](link.md)
- [`ls`](ls.md) · [`ls-user`](ls-user.md) · [`recent`](recent.md) · [`project`](project.md)
- [`recall`](recall.md) · [`recall-auto`](recall-auto.md) · [`explain`](explain.md) · [`plan`](plan.md)
- [`consolidate`](consolidate.md) · [`verify`](verify.md) · [`contest`](contest.md)
- [`backup`](backup.md) · [`restore`](restore.md) · [`export`](export.md) · [`stats`](stats.md)

## Graph and repository intelligence

- [`ga`](ga.md) · [`ge`](ge.md) · [`gn`](gn.md) · [`gp`](gp.md) · [`gc`](gc.md)
- [`gx`](gx.md) · [`gs`](gs.md) · [`gi`](gi.md) · [`query`](query.md)
- [`scan`](scan.md) · [`entities`](entities.md) · [`history`](history.md) · [`digest`](digest.md)
- [`import`](import.md) · [`sq`](sq.md)

## Runtime integration

- [`projects`](projects.md) · [`service`](service.md) · [`serve`](serve.md)
- [`watch`](watch.md) · [`hook`](hook.md) · [`mcp`](mcp.md)

Diagnostic commands remain available for compatibility. The recommended
complete repository path is `cm init --deep`, then `cm update --memory --deep`.
