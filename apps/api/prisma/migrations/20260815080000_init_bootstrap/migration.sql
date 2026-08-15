-- CreateTable
CREATE TABLE "_bootstrap_probe" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_bootstrap_probe_pkey" PRIMARY KEY ("id")
);
