import ProductDetailView from "../ProductDetail";

export default async function ProductPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ varianteId?: string | string[] }>;
}) {
  const { id } = await params;
  const { varianteId } = await searchParams;
  return <ProductDetailView key={id} produtoId={id} varianteId={typeof varianteId === "string" ? varianteId : undefined} />;
}
