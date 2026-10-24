/** Public surface of the documents module (templates, generated documents, labels, print stations). */
export {
  listTemplates,
  getTemplate,
  createTemplate,
  createDraftVersion,
  updateDraftDefinition,
  submitVersion,
  approveVersion,
  returnVersionToDraft,
  retireVersion,
  labelLayoutTemplates,
  type TemplateDetail,
} from "./templates";
export { listLabelTemplates, getLabelTemplate, createLabelTemplate, updateLabelTemplate, approveLabelTemplate, retireLabelTemplate, LABEL_DATASET_FOR } from "./label-templates";
export { listStations, getStation, createStation, updateStation } from "./stations";
export {
  getGeneratedDocument,
  listDocumentsForSource,
  findDocumentByNumber,
  reprintDocument,
  voidDocument,
  requestPdfDownload,
  recentDocuments,
  renderForDisplay,
  type GeneratedDocumentDetail,
} from "./generated";
export {
  labelRequestOptions,
  createLabelJob,
  createLabelJobsForLots,
  markLabelJobPrinted,
  markLabelJobFailed,
  retryLabelJob,
  cancelLabelJob,
  reprintLabelJob,
  voidLabelJob,
  stationQueue,
  labelHistory,
  getLabelJob,
  labelJobForPrint,
  type LabelJobView,
} from "./label-jobs";
export { generateTemplateTestPage, labelTestPage } from "./test-pages";
export { REPRINT_REASONS, reprintReason } from "./reasons";
export { pdfFilesAvailable, pdfSetupMessage, pdfRenderer } from "./config";
export { supportedKinds } from "./renderers/registry";
export { LABEL_DATASETS } from "./renderers/label-v1";
export { LABEL_FIELD_KEYS, DEFAULT_LABEL_FIELDS } from "./schemas";
export { approvedLabelTemplatesFor } from "./label-templates";
export { activeStationsAt } from "./stations";
// Wave 2 W2D: documents generated for other modules' records (BMR, paper pages) and the BMR dataset contract.
export { resolveTemplateVersion, generateForSource, documentsForSource, documentsForSourceRead, renderPreview, type SourceTemplate } from "./source-documents";
export { bmrDataSchema, bmrPaperPageDataSchema, BMR_SECTIONS, BMR_REQUIRED_SECTIONS, type BmrData, type BmrPaperPageData, type BmrSectionId } from "./renderers/bmr-data";
export { bmrContentHash, defaultBmrDefinition } from "./renderers/bmr-v1";
export { defaultBmrPaperPageDefinition } from "./renderers/bmr-paper-page-v1";
