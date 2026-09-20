import { readdirSync } from "node:fs";
import path from "node:path";
import { notFound, redirect } from "next/navigation";

type Props = {
  params: Promise<{
    component: string;
    collection: string;
  }>;
};

const basePath = path.join(process.cwd(), "../../packages/patterns");

const CollectionPage = async ({ params }: Props) => {
  const { component, collection } = await params;

  try {
    // Get all component files in this collection
    const files = readdirSync(`${basePath}/${component}/${collection}`, {
      withFileTypes: true,
    });
    const componentFiles = files.filter(
      (file) => file.isFile() && file.name.endsWith(".tsx")
    );

    if (componentFiles.length === 0) {
      notFound();
    }

    // Get the first component file
    const firstComp = componentFiles[0].name.replace(".tsx", "");

    // Redirect to the first available pattern
    redirect(`/patterns/${component}/${collection}/${firstComp}`);
  } catch {
    notFound();
  }
};

export default CollectionPage;
