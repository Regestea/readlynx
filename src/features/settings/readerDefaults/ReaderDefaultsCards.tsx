import { BookOpen, FileText, ScrollText } from "lucide-react";
import { Card } from "../../../components/ui/Card/Card";
import { Button } from "../../../components/ui/Button/Button";
import { Checkbox } from "../../../components/ui/Checkbox/Checkbox";
import { FontFamilySelect } from "../../../components/FontFamilySelect/FontFamilySelect";
import { Code } from "../../../components/ui/Code/Code";
import { MermaidDiagram } from "../../../components/markdown/MermaidDiagram";
import { useReaderDefaults } from "../../../hooks/useReaderDefaults.ts";
import { DefaultColorField, ZoomField } from "./fields.tsx";
import styles from "./readerDefaults.module.css";

const CODE_PREVIEW = `function greet(name: string) {
  return \`Hello, \${name}!\`;
}`;

const DIAGRAM_PREVIEW = `flowchart LR
  A[Start] --> B{Ready?}
  B -->|Yes| C[Render]
  B -->|No| A`;

/** Global EPUB defaults: starting zoom, font and colors for books whose
 *  EPUB settings were never customized per book. */
export function EpubDefaultsCard() {
  const defaults = useReaderDefaults("epub");

  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <BookOpen size={16} strokeWidth={1.8} />
          </span>
          <h2 className={styles.sectionTitle}>EPUB defaults</h2>
        </div>
        <p className={styles.sectionDesc}>
          Starting zoom, font and colors for newly added EPUB books. Changing a book inside its
          reader keeps winning over these defaults.
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Font family</span>
          <span className={styles.fieldHint}>Empty = each book&apos;s own font.</span>
          <FontFamilySelect
            value={defaults.fontFamily}
            onSelect={(value) => defaults.setValues({ fontFamily: value })}
            defaultLabel="Book font"
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Zoom</span>
          <span className={styles.fieldHint}>Text size for new EPUB books.</span>
          <ZoomField
            value={defaults.zoomPct}
            onChange={(zoomPct) => defaults.setValues({ zoomPct })}
          />
        </div>
      </div>

      <div className={styles.grid}>
        <DefaultColorField
          label="Background color"
          hint="Empty = follow the app theme."
          value={defaults.customBg}
          onChange={(customBg) => defaults.setValues({ customBg })}
        />
        <DefaultColorField
          label="Text color"
          hint="Empty = follow the app theme."
          value={defaults.customText}
          onChange={(customText) => defaults.setValues({ customText })}
        />
        <DefaultColorField
          label="Code block background"
          hint="Empty = follow the page background."
          value={defaults.codeBackground}
          onChange={(codeBackground) => defaults.setValues({ codeBackground })}
        />
      </div>

      <div className={styles.toggles}>
        <Checkbox
          checked={defaults.softBookColors}
          onChange={(softBookColors) => defaults.setValues({ softBookColors })}
          label="Replace harsh book colors with soft reading inks"
        />
        <Checkbox
          checked={defaults.hardOverrideText}
          onChange={(hardOverrideText) => defaults.setValues({ hardOverrideText })}
          label="Force the text color onto every element (hard override)"
        />
      </div>

      <div className={styles.footer}>
        <Button variant="ghost" onClick={defaults.reset}>
          Reset EPUB defaults
        </Button>
      </div>
    </Card>
  );
}

/** Global defaults for the translated-text (Markdown) reading view. */
export function TranslationDefaultsCard() {
  const defaults = useReaderDefaults("markdown");

  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <ScrollText size={16} strokeWidth={1.8} />
          </span>
          <h2 className={styles.sectionTitle}>Translation defaults</h2>
        </div>
        <p className={styles.sectionDesc}>
          Starting zoom, font and colors for the translated-text view. Per-book changes inside
          the reader keep winning over these defaults.
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Font family</span>
          <span className={styles.fieldHint}>Empty = the reader default font.</span>
          <FontFamilySelect
            value={defaults.fontFamily}
            onSelect={(value) => defaults.setValues({ fontFamily: value })}
            defaultLabel="Reader font"
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Zoom</span>
          <span className={styles.fieldHint}>Text size for new translations.</span>
          <ZoomField
            value={defaults.zoomPct}
            onChange={(zoomPct) => defaults.setValues({ zoomPct })}
          />
        </div>
      </div>

      <div className={styles.grid}>
        <DefaultColorField
          label="Background color"
          hint="Empty = follow the app theme."
          value={defaults.customBg}
          onChange={(customBg) => defaults.setValues({ customBg })}
        />
        <DefaultColorField
          label="Text color"
          hint="Empty = follow the app theme."
          value={defaults.customText}
          onChange={(customText) => defaults.setValues({ customText })}
        />
      </div>

      <div className={styles.subsection}>
        <h3 className={styles.subsectionTitle}>Code blocks & diagrams</h3>
        <p className={styles.subsectionDesc}>
          Card backgrounds for fenced code blocks and Mermaid diagrams.
          Empty follows the theme card. Per-book changes in the reader toolbar
          keep winning over these defaults.
        </p>

        <div className={styles.grid}>
          <DefaultColorField
            label="Code block background"
            hint="Empty = follow the theme card."
            value={defaults.codeBackground}
            onChange={(codeBackground) => defaults.setValues({ codeBackground })}
          />
          <DefaultColorField
            label="Diagram background"
            hint="Empty = follow the theme card."
            value={defaults.diagramBackground}
            onChange={(diagramBackground) => defaults.setValues({ diagramBackground })}
          />
        </div>

        <div className={styles.preview}>
          <div className={styles.previewCard}>
            <span className={styles.previewLabel}>Code preview</span>
            <div className={styles.previewBody}>
              <Code
                code={CODE_PREVIEW}
                language="typescript"
                themeOverride={defaults.codeTheme}
                background={defaults.codeBackground}
              />
            </div>
          </div>
          <div className={styles.previewCard}>
            <span className={styles.previewLabel}>Diagram preview</span>
            <div className={styles.previewBody}>
              <MermaidDiagram
                chart={DIAGRAM_PREVIEW}
                themeOverride={defaults.diagramTheme}
                background={defaults.diagramBackground}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <Button variant="ghost" onClick={defaults.reset}>
          Reset translation defaults
        </Button>
      </div>
    </Card>
  );
}

/** Global PDF default: reading background for newly added PDF books. */
export function PdfDefaultsCard() {
  const defaults = useReaderDefaults("pdf");

  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <FileText size={16} strokeWidth={1.8} />
          </span>
          <h2 className={styles.sectionTitle}>PDF defaults</h2>
        </div>
        <p className={styles.sectionDesc}>
          Starting reading background for newly added PDF books. Changing a book inside its
          reader keeps winning over this default.
        </p>
      </div>

      <DefaultColorField
        label="Reading background"
        hint="Empty = the default warm paper."
        value={defaults.pdfBackground}
        onChange={(pdfBackground) => defaults.setValues({ pdfBackground })}
        themeLabel="Default paper"
      />

      <div className={styles.footer}>
        <Button variant="ghost" onClick={defaults.reset}>
          Reset PDF defaults
        </Button>
      </div>
    </Card>
  );
}
