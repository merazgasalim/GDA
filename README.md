# Gestion des Arrivages

Application de bureau Windows pour professionnels de pièces auto - Suivi des prix et historique des arrivages.

## Fonctionnalités

- **Grille de données** avec filtres par colonne, recherche globale, tri et pagination
- **Import Excel** par copier-coller (pas d'upload de fichier)
- **Export CSV/XLSX** (licence requise)
- **Système de licence** avec validation RSA et liaison machine
- **Base de données SQLite chiffrée** avec SQLCipher
- **Interface clavier-first** pour navigation rapide

## Architecture

```
src/
├── main/               # Processus principal Electron
│   ├── services/       # Services (DB, licence, import, export)
│   ├── ipc-handlers.ts # Gestionnaires IPC
│   ├── preload.ts      # Script de préchargement (API sécurisée)
│   └── index.ts        # Point d'entrée principal
├── renderer/           # Interface React
│   ├── components/     # Composants UI
│   ├── store/          # État global (Zustand)
│   └── styles/         # Styles CSS
└── shared/             # Types et contrats partagés
    ├── types.ts        # Schémas Zod et types
    └── ipc-channels.ts # Canaux IPC typés
```

## Sécurité

- **Isolation de contexte**: Le renderer n'a pas accès à Node.js
- **Validation IPC**: Tous les inputs sont validés avec Zod
- **Vérification des permissions**: Opérations privilégiées vérifiées
- **Chiffrement de la base**: SQLCipher avec clé dérivée de la licence

## Installation

```bash
# Installer les dépendances
npm install

# Lancer en mode développement
npm run electron:dev

# Construire pour Windows
npm run build:win
```

## Modèle de données

Le modèle utilise une **dénormalisation intentionnelle**:

- Table unique `PriceEntry` avec données fournisseur intégrées
- Entrées **immutables** (jamais de mise à jour)
- Permet imports rapides et requêtes simples
- Historique préservé (mémoire des prix)

## Licence

Application commerciale - Licence requise pour:
- Export (CSV, XLSX)
- Sauvegarde
- Import illimité

Mode lecture seule disponible sans licence.

## Stack technique

- Electron 28
- Vite 5
- React 18
- TypeScript 5
- Prisma ORM
- SQLite + SQLCipher
- TailwindCSS
- Zustand
