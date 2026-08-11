import StudyDashboard from './components/StudyDashboard';
import StudyDocumentPage from './components/StudyDocumentPage';
import StudyLayout, { StudyEmptyState } from './components/StudyLayout';
import StudyLibrary from './components/StudyLibrary';
import StudyManagePage from './components/StudyManagePage';
import StudyPreviewPage from './components/StudyPreviewPage';
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

const decodeUnitPreviewIdFromPath = (path: string): string | null => {
  const match = path.match(/^\/study\/unit\/([^/]+)\/preview$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const StudyApp = () => {
  const study = useStudyApp();
  const documentId = decodeDocumentIdFromPath(study.routePath);
  const unitEditId = decodeUnitEditIdFromPath(study.routePath);
  const unitPreviewId = decodeUnitPreviewIdFromPath(study.routePath);

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
    if (unitPreviewId) {
      return (
        <StudyPreviewPage
          data={study.data}
          unitId={unitPreviewId}
          onNavigate={study.navigate}
        />
      );
    }
    if (study.routePath === '/study/library') {
      return (
        <StudyLibrary
          data={study.data}
          onSelectDocument={study.selectDocument}
          onCreateCustomUnit={study.createCustomUnit}
          onEditUnit={(unitId) => study.navigate(`/study/unit/${encodeURIComponent(unitId)}/edit`, { returnTo: '/study/library' })}
          onPreviewUnit={(unitId) => study.navigate(`/study/unit/${encodeURIComponent(unitId)}/preview`, { returnTo: '/study/library?tab=units' })}
          onOpenProvision={(documentId, sourceKey) =>
            study.navigate(`/study/document/${encodeURIComponent(documentId)}#${encodeURIComponent(sourceKey)}`)
          }
          onDeleteUnit={study.deleteUnit}
          onDuplicateUnit={study.duplicateUnit}
        />
      );
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
          onPreviewUnit={(unitId) =>
            study.navigate(`/study/unit/${encodeURIComponent(unitId)}/preview`, {
              returnTo: `/study/document/${encodeURIComponent(documentId)}`,
            })
          }
        />
      );
    }
    if (study.routePath === '/study/session') {
      return (
        <StudySessionPage
          activeItem={study.activeItem}
          answer={study.answer}
          onAnswerChange={study.setAnswer}
          guidedResponses={study.guidedResponses}
          onGuidedResponsesChange={study.setGuidedResponses}
          responseMode={study.responseMode}
          revealed={study.revealed}
          onRevealChange={study.setRevealed}
          coveredConceptIds={study.coveredConceptIds}
          onToggleConcept={study.toggleConcept}
          rubricCoverage={study.rubricCoverage}
          onRubricCoverageChange={study.setRubricCoverage}
          ratingPending={study.ratingPending}
          ratingPreviews={study.ratingPreviews}
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
          onDeleteAllData={study.deleteAllData}
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
    <StudyLayout
      activePath={study.routePath}
      sidebarCollapsed={Boolean(study.data?.settings.studySidebarCollapsed)}
      onSidebarCollapsedChange={(collapsed) => {
        if (study.data) void study.saveSettings({ ...study.data.settings, studySidebarCollapsed: collapsed });
      }}
      onNavigate={study.navigate}
    >
      {renderPage()}
    </StudyLayout>
  );
};

export default StudyApp;
