import { readdirSync } from "node:fs";
import path from "node:path";
import { notFound, redirect } from "next/navigation";

type Props = {
  params: Promise<{
    component: string;
  }>;
};

const basePath = path.join(process.cwd(), "../../packages/patterns");

const ComponentPage = async ({ params }: Props) => {
  const { component } = await params;

  try {
    // Get all collections for this component
    const collectionsDirectory = readdirSync(`${basePath}/${component}`, {
      withFileTypes: true,
    });
    const collections = collectionsDirectory.filter((file) =>
      file.isDirectory()
    );

    if (collections.length === 0) {
      notFound();
    }

    // Get the first collection
    const firstCollection = collections[0];

    // Get all component files in the first collection
    const files = readdirSync(
      `${basePath}/${component}/${firstCollection.name}`,
      {
        withFileTypes: true,
      }
    );
    const componentFiles = files.filter(
      (file) => file.isFile() && file.name.endsWith(".tsx")
    );

    if (componentFiles.length === 0) {
      notFound();
    }

    // Get the first component file
    const firstComp = componentFiles[0].name.replace(".tsx", "");

    // Redirect to the first available pattern
    redirect(`/patterns/${component}/${firstCollection.name}/${firstComp}`);
  } catch {
    notFound();
  }
};

export default ComponentPage;
