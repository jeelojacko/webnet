import StudyDashboard from './components/StudyDashboard';
import StudyAuthoringPage from './components/StudyAuthoringPage';
import StudyDocumentPage from './components/StudyDocumentPage';
import StudyLayout, { StudyEmptyState } from './components/StudyLayout';
import StudyLibrary from './components/StudyLibrary';
import StudyManagePage from './components/StudyManagePage';
import StudyPreviewPage from './components/StudyPreviewPage';
import StudyPracticePage from './components/StudyPracticePage';
import StudySessionPage from './components/StudySessionPage';
import StudyUnitEditorPage from './components/StudyUnitEditorPage';
import { ExamPrepPage } from './examPrep/ExamPrepPage';
import { decodeExamPrepView } from './examPrep/examPrepRoutes';
import { selectSurprisePracticeUnitId } from './studySessionItems';
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

const decodeUnitPracticeIdFromPath = (path: string): string | null => {
  const match = path.match(/^\/study\/unit\/([^/]+)\/practice$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const StudyApp = () => {
  const study = useStudyApp();
  const documentId = decodeDocumentIdFromPath(study.routePath);
  const unitEditId = decodeUnitEditIdFromPath(study.routePath);
  const unitPreviewId = decodeUnitPreviewIdFromPath(study.routePath);
  const unitPracticeId = decodeUnitPracticeIdFromPath(study.routePath);

  const renderPage = () => {
    if (!study.data) return <StudyEmptyState text="Loading study data..." />;
    const examPrepView = decodeExamPrepView(study.routePath);
    if (examPrepView) {
      return (
        <ExamPrepPage
          view={examPrepView}
          data={study.data}
          onNavigate={study.navigate}
          onOpenProvision={(documentId, sourceKey) =>
            study.navigate(
              `/study/document/${encodeURIComponent(documentId)}#${encodeURIComponent(sourceKey)}`,
            )
          }
          onToggleUnitStudied={study.toggleUnitStudied}
          onRateRecallTask={study.rateRecallTask}
        />
      );
    }
    if (unitEditId) {
      return (
        <StudyUnitEditorPage
          data={study.data}
          unitId={unitEditId}
          onLoadLegalComponentsBySourceKeys={study.getLegalComponentsBySourceKeys}
          onSave={study.saveUnitAuthoring}
          onAcknowledgeSourceReview={study.acknowledgeSourceReview}
          onUndoLatestRating={study.undoLatestStudyRatingForUnit}
          onNavigate={study.navigate}
        />
      );
    }
    if (unitPreviewId) {
      return (
        <StudyPreviewPage
          data={study.data}
          unitId={unitPreviewId}
          onLoadLegalComponentsBySourceKeys={study.getLegalComponentsBySourceKeys}
          onNavigate={study.navigate}
        />
      );
    }
    if (unitPracticeId) {
      return (
        <StudyPracticePage
          data={study.data}
          unitId={unitPracticeId}
          mode="manual-practice"
          onSavePracticeAttempt={study.savePracticeAttempt}
          onNavigate={study.navigate}
        />
      );
    }
    if (study.routePath === '/study/surprise') {
      return (
        <StudyPracticePage
          data={study.data}
          unitId={selectSurprisePracticeUnitId(study.data)}
          mode="surprise-practice"
          onSavePracticeAttempt={study.savePracticeAttempt}
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
          onEditUnit={(unitId) =>
            study.navigate(`/study/unit/${encodeURIComponent(unitId)}/edit`, {
              returnTo: '/study/library',
            })
          }
          onPreviewUnit={(unitId) =>
            study.navigate(`/study/unit/${encodeURIComponent(unitId)}/preview`, {
              returnTo: '/study/library?tab=units',
            })
          }
          onPracticeUnit={(unitId) =>
            study.navigate(`/study/unit/${encodeURIComponent(unitId)}/practice`, {
              returnTo: '/study/library?tab=units',
            })
          }
          onOpenProvision={(documentId, sourceKey) =>
            study.navigate(
              `/study/document/${encodeURIComponent(documentId)}#${encodeURIComponent(sourceKey)}`,
            )
          }
          onDeleteUnit={study.deleteUnit}
          onDuplicateUnit={study.duplicateUnit}
          onLoadLegalDocumentComponentSummary={study.getLegalDocumentComponentSummary}
        />
      );
    }
    if (documentId) {
      return (
        <StudyDocumentPage
          data={study.data}
          documentId={documentId}
          onLoadLegalComponentsByDocument={study.getLegalComponentsByDocument}
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
          completionSummary={study.sessionCompletionSummary}
          nextScheduledReview={study.nextScheduledReview}
          onUndoLatestRating={study.undoLatestStudyRating}
          onOpenUnit={(unitId) =>
            study.navigate(`/study/unit/${encodeURIComponent(unitId)}/edit`, {
              returnTo: '/study/session',
            })
          }
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
    if (study.routePath === '/study/authoring') {
      return (
        <StudyAuthoringPage
          data={study.data}
          aiImportText={study.aiImportText}
          onAiImportTextChange={study.setAiImportText}
          onImportAiAuthoring={study.importAiAuthoringJson}
          onUpdateMapProposal={study.updateAiStudyMapProposal}
          onUpdateUnitProposal={study.updateAiUnitProposal}
          onValidateUnitProposal={study.validateAiUnitProposalById}
          onApproveUnitProposal={study.approveAiUnitProposal}
          statusMessage={study.statusMessage}
        />
      );
    }
    return (
      <StudyDashboard
        data={study.data}
        sessionItems={study.sessionItems}
        onNavigate={study.navigate}
        onSurprisePractice={() => study.navigate('/study/surprise')}
      />
    );
  };

  return (
    <StudyLayout
      activePath={study.routePath}
      sidebarCollapsed={Boolean(study.data?.settings.studySidebarCollapsed)}
      onSidebarCollapsedChange={(collapsed) => {
        if (study.data)
          void study.saveSettings({ ...study.data.settings, studySidebarCollapsed: collapsed });
      }}
      onNavigate={study.navigate}
    >
      {renderPage()}
    </StudyLayout>
  );
};

export default StudyApp;
