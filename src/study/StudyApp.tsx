import StudyDashboard from './components/StudyDashboard';
import StudyDocumentPage from './components/StudyDocumentPage';
import StudyLayout, { StudyEmptyState } from './components/StudyLayout';
import StudyLibrary from './components/StudyLibrary';
import StudyManagePage from './components/StudyManagePage';
import StudySessionPage from './components/StudySessionPage';
import StudyUnitEditorPage from './components/StudyUnitEditorPage';
import { useStudyApp } from './useStudyApp';

const decodeDocumentIdFromPath = (path: string): string | null => {
  const match = path.match(/^\/study\/document\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const decodeUnitEditIdFromPath = (path: string): string | null => {
  const match = path.match(/^\/study\/unit\/([^/]+)\/edit$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const StudyApp = () => {
  const study = useStudyApp();
  const documentId = decodeDocumentIdFromPath(study.routePath);
  const unitEditId = decodeUnitEditIdFromPath(study.routePath);

  const renderPage = () => {
    if (!study.data) return <StudyEmptyState text="Loading study data..." />;
    if (unitEditId) {
      return (
        <StudyUnitEditorPage
          data={study.data}
          unitId={unitEditId}
          onSave={study.saveUnitAuthoring}
          onNavigate={study.navigate}
        />
      );
    }
    if (study.routePath === '/study/library') {
      return <StudyLibrary data={study.data} onSelectDocument={study.selectDocument} />;
    }
    if (documentId) {
      return (
        <StudyDocumentPage
          data={study.data}
          documentId={documentId}
          onSaveDocument={study.saveDocument}
          onSaveUnit={study.saveUnit}
          onCompleteReading={study.completeReading}
          onCreateUnitFromSelection={study.createUnitFromSourceSelection}
          onGenerateMissingStudyContent={study.generateMissingStudyContent}
          onAcknowledgeSourceReview={study.acknowledgeSourceReview}
          onSelectDocument={study.selectDocument}
          onNavigate={study.navigate}
        />
      );
    }
    if (study.routePath === '/study/session') {
      return (
        <StudySessionPage
          activeItem={study.activeItem}
          answer={study.answer}
          onAnswerChange={study.setAnswer}
          revealed={study.revealed}
          onRevealChange={study.setRevealed}
          coveredConceptIds={study.coveredConceptIds}
          onToggleConcept={study.toggleConcept}
          onRate={study.rateActiveItem}
        />
      );
    }
    if (study.routePath === '/study/manage') {
      return (
        <StudyManagePage
          data={study.data}
          exportText={study.exportText}
          importText={study.importText}
          onImportTextChange={study.setImportText}
          onImport={study.importData}
          officialPackageText={study.officialPackageText}
          onOfficialPackageTextChange={study.setOfficialPackageText}
          officialPackagePreview={study.officialPackagePreview}
          onPreviewOfficialPackage={study.previewOfficialPackage}
          onImportOfficialPackage={study.importOfficialPackage}
          statusMessage={study.statusMessage}
        />
      );
    }
    return (
      <StudyDashboard
        data={study.data}
        sessionItems={study.sessionItems}
        onNavigate={study.navigate}
      />
    );
  };

  return (
    <StudyLayout activePath={study.routePath} onNavigate={study.navigate}>
      {renderPage()}
    </StudyLayout>
  );
};

export default StudyApp;
