# OBESYSTEM

Outcome-Based Education (OBE) Attainment & Accreditation Management System.

## Overview
A comprehensive full-stack OBE management system featuring role-based access control, curriculum mapping (PEOs, PLOs, CLOs), assessment grading, attainment calculation, and reporting.

- **Frontend:** React 19, Tailwind CSS, Lucide Icons, Recharts, Vite
- **Backend:** Node.js, Express, TypeScript, Prisma ORM
- **Database:** PostgreSQL

## Getting Started

### Prerequisites
- Node.js 20.19+ (Node.js 22 LTS recommended)
- npm or yarn

### Installation
```bash
npm install
```

### Environment Setup
Copy the sample environment file and configure variables:
```bash
cp .env.example .env
```

### Database & Development
```bash
# Generate Prisma Client & Apply Existing Migrations
npm run db:generate
npm run db:migrate

# Install the documented demonstration dataset on a new/empty database only
npm run db:seed

# Start Development Server (Frontend + Backend + DB)
npm run dev
```

### Build & Production
```bash
npm run build
npm start
```

## Verification

```bash
npm run test:unit
npm test
npx playwright test
npm run typecheck
npm run lint
npm run build
```

The Playwright configuration defaults to headed installed Google Chrome. Integration
and browser suites use disposable `obe_test` and `obe_e2e` databases rather than the
development database.

See [`docs/SYSTEM_REPORT.md`](docs/SYSTEM_REPORT.md) for the complete architecture,
authentication, relationship, security, role-workflow and test-execution audit.
