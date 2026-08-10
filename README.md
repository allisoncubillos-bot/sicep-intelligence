# SICEP Intelligence

Suite de automatización e inteligencia sobre convocatorias de compra de energía del
**Mercado Regulado** colombiano (SICEP MEM).
Por **Allison Cubillos** ([@allisoncubillos-bot](https://github.com/allisoncubillos-bot)).

## Módulos

| Módulo | Estado | Qué hace |
|---|---|---|
| **[TenderRadar](TenderRadar/)** | ✅ En producción | Monitoreo y alertas: *scraping* de SICEP en flujos automatizados (semanal y diario), agenda las audiencias públicas en Google Calendar y analiza con IA (API de Claude) los pliegos de las nuevas convocatorias, notificando en Slack. |
| **TenderParser** | 🚧 Próximamente | ETL: parsea las presentaciones de las audiencias (PDF) y los Excels, analiza la información y la carga a la base de datos. |

Cada módulo tiene su propio README con instalación, configuración y uso.

## Migrar a otra máquina

[`MIGRACION-A-MAC.md`](MIGRACION-A-MAC.md) — guía paso a paso para mover
TenderRadar de Windows (Task Scheduler) a Mac (launchd), pensada para
seguirla a mano o para dársela directo a Claude Code y que la ejecute.
