# OBESYSTEM

Outcome-Based Education (OBE) Attainment & Accreditation Management System.

## Overview
A comprehensive full-stack OBE management system featuring role-based access control, curriculum mapping (PEOs, PLOs, CLOs), assessment grading, attainment calculation, and reporting.

- **Frontend:** React 19, Tailwind CSS, Lucide Icons, Recharts, Vite
- **Backend:** Node.js, Express, TypeScript, Prisma ORM
- **Database:** PostgreSQL

## Getting Started

### Prerequisites
- Node.js (v18+)
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
# Generate Prisma Client & Run Migrations
npm run db:generate
npm run db:migrate:dev

# Start Development Server (Frontend + Backend + DB)
npm run dev
```

### Build & Production
```bash
npm run build
npm start
```
