import { PageHeader } from "@/components/ui";
import { PresetsManager } from "./presets-manager";

export default function PresetsPage() {
  return (
    <>
      <PageHeader eyebrow="◆ estilo" title="Presets" />
      <p className="mb-6 max-w-xl text-sm text-text-dim">
        Monte estilos de legenda (fonte, cor, contorno, fundo, posição) e reutilize
        ao enviar. O preview mostra o resultado real do tratamento.
      </p>
      <PresetsManager />
    </>
  );
}
