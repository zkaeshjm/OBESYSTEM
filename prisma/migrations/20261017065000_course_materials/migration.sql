-- Learning materials are external links (object storage or institutional LMS).
-- The database stores metadata only; it never stores file bytes.
CREATE TABLE "course_materials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offeringId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "url" TEXT NOT NULL,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "course_materials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "course_materials_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "course_materials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "course_material_url_http" CHECK ("url" ~ '^https?://'),
  CONSTRAINT "course_material_title_present" CHECK (length(trim("title")) > 0)
);
CREATE INDEX "course_materials_offeringId_isPublished_idx" ON "course_materials"("offeringId", "isPublished");
