/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "MainMenuControl.h"

#import "DirectoryItem.h"

#import "AlertMessage.h"
#import "ControlConstants.h"
#import "LocalizableStrings.h"
#import "DirectoryViewControl.h"
#import "DirectoryViewControlSettings.h"
#import "DirectoryViewDisplaySettings.h"
#import "ControlPanelControl.h"
#import "SaveImageDialogControl.h"
#import "PreferencesPanelControl.h"
#import "FiltersWindowControl.h"
#import "UniformTypeRankingWindowControl.h"
#import "FilterSelectionPanelControl.h"
#import "StartWindowControl.h"
#import "ExportAsTextDialogControl.h"

#import "ItemPathModel.h"
#import "ItemPathModelView.h"
#import "TreeFilter.h"
#import "TreeWriter.h"
#import "TreeReader.h"
#import "TreeContext.h"
#import "AnnotatedTreeContext.h"
#import "TreeBuilder.h"
#import "TreeRefresher.h"

#import "WindowManager.h"

#import "AsynchronousTaskManager.h"
#import "VisibleAsynchronousTaskManager.h"
#import "ScanProgressPanelControl.h"
#import "ScanTaskInput.h"
#import "ScanTaskOutput.h"
#import "ScanTaskExecutor.h"
#import "FilterProgressPanelControl.h"
#import "FilterTaskInput.h"
#import "FilterTaskExecutor.h"
#import "ReadProgressPanelControl.h"
#import "ReadTaskInput.h"
#import "ReadTaskExecutor.h"
#import "WriteProgressPanelControl.h"
#import "WriteTaskInput.h"
#import "WriteTaskExecutor.h"
#import "RawTreeWriterOptions.h"

#import "FilterRepository.h"
#import "FilterTestRepository.h"
#import "NamedFilter.h"
#import "FilterSet.h"
#import "Filter.h"

#import "UniformTypeRanking.h"
#import "UniformTypeInventory.h"

#import "NSURL.h"

// Possible behaviors after performing a rescan
NSString  *RescanClosesOldWindow = @"close old window";
NSString  *RescanKeepsOldWindow = @"keep old window";
NSString  *RescanReusesOldWindow = @"reuse old window"; // Not (yet?) supported

// Possible behaviors when initiating a rescan
NSString  *RescanAll = @"rescan all";
NSString  *RescanVisible = @"rescan visible";

// Possible behaviors when the last directory view window is closed
NSString  *AfterClosingLastViewQuit = @"quit";
NSString  *AfterClosingLastViewShowWelcome = @"show welcome";
NSString  *AfterClosingLastViewDoNothing = @"do nothing";

@interface ReadTaskCallback : NSObject {
  WindowManager  *windowManager;
  ReadTaskInput  *taskInput;
}

// Overrides designated initialiser
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithWindowManager:(WindowManager *)windowManager
                         readTaskInput:(ReadTaskInput *)taskInput NS_DESIGNATED_INITIALIZER;

- (void) readTaskCompleted:(TreeReader *)treeReader;

@end // @interface ReadTaskCallback


@interface WriteTaskCallback : NSObject {
  WriteTaskInput  *taskInput;
}

// Overrides designated initialiser
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithWriteTaskInput:(WriteTaskInput *)taskInput NS_DESIGNATED_INITIALIZER;

- (void) writeTaskCompleted:(id)result;

@end // @interface WriteTaskCallback


@interface FreshDirViewWindowCreator : NSObject {
  WindowManager  *windowManager;
}

@property BOOL  addToRecentScans;

// Overrides designated initialiser
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithWindowManager:(WindowManager *)windowManager NS_DESIGNATED_INITIALIZER;

// Various callback entry points
- (DirectoryViewControl *)createWindowForScanResult:(ScanTaskOutput *)scanResult;
- (DirectoryViewControl *)createWindowForTree:(TreeContext *)treeContext;
- (DirectoryViewControl *)createWindowForAnnotatedTree:(AnnotatedTreeContext *)annTreeContext;

// Factory helper method to create DirectoryViewControl instance. Designed to be overridden.
- (DirectoryViewControl *)createDirectoryViewControlForAnnotatedTree: 
                            (AnnotatedTreeContext *)annTreeContext;

@end // @interface FreshDirViewWindowCreator


@interface DerivedDirViewWindowCreator : FreshDirViewWindowCreator {
  ItemPathModel  *targetPath;
  DirectoryViewControlSettings  *settings;
}

- (instancetype) initWithWindowManager:(WindowManager *)windowManager
                            targetPath:(ItemPathModel *)targetPath
                              settings:(DirectoryViewControlSettings *)settings NS_DESIGNATED_INITIALIZER;

@end // @interface DerivedDirViewWindowCreator


@interface MainMenuControl (PrivateMethods)

// Show welcome window after delay. This may be aborted by setting showWelcomeWindow to NO
- (void) showWelcomeWindowAfterDelay:(NSTimeInterval) delay;
- (void) showWelcomeWindowAfterDelay; // Only for use by showWelcomeWindowAfterDelay:

- (void) showWelcomeWindow;
- (void) hideWelcomeWindow;

- (void) hideControlPanel;

// Initiates scan after asking the user which folder to scan, and optionally which filter to use.
- (void) scanFolderSelectingFilter:(BOOL)selectFilter;
- (void) scanFolder:(NSString *)path namedFilter:(NamedFilter *)filter;
- (void) scanFolder:(NSString *)path namedFilters:(NSArray *)filters;
- (void) scanFolder:(NSString *)path filterSet:(FilterSet *)filterSet;

- (void) refreshItem:(DirectoryItem *)item deriveFrom:(DirectoryViewControl *)oldControl;

- (void) rescanItem:(FileItem *)item deriveFrom:(DirectoryViewControl *)oldControl;
- (void) rescanItem:(FileItem *)item
         deriveFrom:(DirectoryViewControl *)oldControl
           settings:(DirectoryViewControlSettings *)controlSettings
          filterSet:(FilterSet *)filterSet;

- (void) loadScanDataFromFile:(NSURL *)sourceUrl;
- (void) saveScanDataToFile:(NSSavePanel *)savePanel
           usingTaskManager:(VisibleAsynchronousTaskManager *)taskManager
                    options:(id)options;

- (void) duplicateCurrentWindowSharingPath:(BOOL)sharePathModel;

/* Prompts the user to select a filter. The initialSelection, when set, specifies the name of the
 * filter to initially select. The forNewScan argument should be used to signal if the filter will
 * be applied to a new scan, or an existing view. This affects whether or not the user can choose
 * if the default filter (if any) should also be applied.
 *
 * Returns nil when the user cancelled selection. Otherwise returns an array with zero or more
 * NamedFilter instances.
 */
- (NSArray *)selectFilter:(NSString *)initialSelection forNewScan:(BOOL)forNewScan;

- (NamedFilter *)defaultNamedFilter;

+ (FilterSet *)updateFiltersIfNeeded:(FilterSet *)filterSet;

/* Helper method for reporting the names of unbound filters or filter tests.
 */
+ (void) reportUnbound:(NSArray *)unboundNames
         messageFormat:(NSString *)format
              infoText:(NSString *)infoText;

/* Creates window title based on scan location, scan time and filter (if any).
 */
+ (NSString *)windowTitleForDirectoryView:(DirectoryViewControl *)control;

- (void) viewWillOpen:(NSNotification *)notification;
- (void) viewWillClose:(NSNotification *)notification;
- (void) viewProducingTaskScheduled:(NSNotification *)notification;
- (void) viewProducingTaskCompleted:(NSNotification *)notification;

- (void) checkShowWelcomeWindow:(BOOL)allowAutoQuit;

@end // @interface MainMenuControl (PrivateMethods)


@implementation MainMenuControl

+ (void) initialize {
  // Load application-defaults from the information properties file.
  NSBundle  *bundle = NSBundle.mainBundle;
  NSDictionary  *appDefaults = [bundle objectForInfoDictionaryKey: @"GPApplicationDefaults"];
  [NSUserDefaults.standardUserDefaults registerDefaults: appDefaults];
  
  // Load the ranked list of uniform types and observe the inventory to ensure that it will be
  // extended when new types are encountered (as a result of scanning).
  UniformTypeRanking  *uniformTypeRanking = UniformTypeRanking.defaultUniformTypeRanking;
  UniformTypeInventory  *uniformTypeInventory = UniformTypeInventory.defaultUniformTypeInventory;
    
  [uniformTypeRanking loadRanking: uniformTypeInventory];

  // Observe the inventory for newly added types. Note: we do not want to receive notifications
  // about types that have been added to the inventory as a result of the recent invocation of
  // -loadRanking:. Calling -observerUniformTypeInventory: using -performSelectorOnMainThread:...
  // ensures that any pending notifications are fired before uniformTypeRanking is added as an
  // observer.
  [uniformTypeRanking performSelectorOnMainThread: @selector(observeUniformTypeInventory:)
                                       withObject: uniformTypeInventory
                                    waitUntilDone: NO];
}

static MainMenuControl  *singletonInstance = nil;
static dispatch_once_t  singletonOnceToken;

+ (MainMenuControl *)singletonInstance {
  return singletonInstance;
}

+ (NSArray *) rescanActionNames {
  return @[RescanAll, RescanVisible];
}

+ (NSArray *) rescanBehaviourNames {
  return @[RescanClosesOldWindow, RescanKeepsOldWindow];
}

+ (NSArray *)noViewsBehaviourNames {
  return
    @[AfterClosingLastViewDoNothing, AfterClosingLastViewShowWelcome, AfterClosingLastViewQuit];
}

+ (void) reportUnboundFilters:(NSArray *)unboundFilters {
  NSString  *format =
    NSLocalizedString(@"Failed to update one or more filters:\n%@", @"Alert message");
  NSString  *infoText = 
    NSLocalizedString(@"These filters do not exist anymore. Their old definition is used instead",
                      @"Alert informative text");
  [self reportUnbound: unboundFilters messageFormat: format infoText: infoText];
}

+ (void) reportUnboundTests:(NSArray *)unboundTests {
  NSString  *format = 
    NSLocalizedString(@"Failed to bind one or more filter tests:\n%@", @"Alert message");
  NSString  *infoText = 
    NSLocalizedString(@"The unbound tests have been omitted from the filter",
                      @"Alert informative text");
  [self reportUnbound: unboundTests messageFormat: format infoText: infoText];
}


- (instancetype) init {
  NSAssert(singletonInstance == nil, @"Can only create one MainMenuControl.");

  dispatch_once(&singletonOnceToken, ^{
    id  initResult = [super init];
    NSAssert(self == initResult, @"Self unexpectedly changed");

    windowManager = [[WindowManager alloc] init];

    ProgressPanelControl  *scanProgressPanelControl = 
      [[[ScanProgressPanelControl alloc]
        initWithTaskExecutor: [[[ScanTaskExecutor alloc] init] autorelease]
       ] autorelease];

    scanTaskManager =
      [[VisibleAsynchronousTaskManager alloc] initWithProgressPanel: scanProgressPanelControl];

    ProgressPanelControl  *filterProgressPanelControl =
      [[[FilterProgressPanelControl alloc]
        initWithTaskExecutor: [[[FilterTaskExecutor alloc] init] autorelease]
       ] autorelease];

    filterTaskManager =
      [[VisibleAsynchronousTaskManager alloc] initWithProgressPanel: filterProgressPanelControl];
          
    ProgressPanelControl  *xmlWriteProgressPanelControl =
      [[[WriteProgressPanelControl alloc] 
        initWithTaskExecutor: [[[XmlWriteTaskExecutor alloc] init] autorelease]
       ] autorelease];

    xmlWriteTaskManager =
      [[VisibleAsynchronousTaskManager alloc] initWithProgressPanel: xmlWriteProgressPanelControl];

    ProgressPanelControl  *rawWriteProgressPanelControl =
      [[[WriteProgressPanelControl alloc]
        initWithTaskExecutor: [[[RawWriteTaskExecutor alloc] init] autorelease]
       ] autorelease];

    rawWriteTaskManager =
      [[VisibleAsynchronousTaskManager alloc] initWithProgressPanel: rawWriteProgressPanelControl];

    ProgressPanelControl  *xmlReadProgressPanelControl =
      [[[ReadProgressPanelControl alloc] 
        initWithTaskExecutor: [[[ReadTaskExecutor alloc] init] autorelease]
       ] autorelease];

    xmlReadTaskManager =
      [[VisibleAsynchronousTaskManager alloc] initWithProgressPanel: xmlReadProgressPanelControl];
    
    // Lazily load the optional panels and windows
    preferencesPanelControl = nil;
    filterSelectionPanelControl = nil;
    filtersWindowControl = nil;
    uniformTypeWindowControl = nil;
    startWindowControl = nil;
    exportAsTextDialogControl = nil;

    viewCount = 0;
    viewTaskCount = 0;

    NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;
    [nc addObserver: self
           selector: @selector(viewWillOpen:)
               name: ViewWillOpenEvent
             object: nil];
    [nc addObserver: self
           selector: @selector(viewWillClose:)
               name: ViewWillCloseEvent
             object: nil];

    NSArray*  viewProducingTaskManagers = @[scanTaskManager, filterTaskManager, xmlReadTaskManager];
    for (NSObject*  taskManager in [viewProducingTaskManagers objectEnumerator]) {
      [nc addObserver: self
             selector: @selector(viewProducingTaskScheduled:)
                 name: TaskScheduledEvent
               object: taskManager];
      [nc addObserver: self
             selector: @selector(viewProducingTaskCompleted:)
                 name: TaskCompletedEvent
               object: taskManager];
    }

    showWelcomeWindow = YES; // Default

    singletonInstance = self;
  });

  NSAssert(self == singletonInstance, @"init should only be invoked once");

  return self;
}

- (void) dealloc {
  singletonInstance = nil;

  [windowManager release];
  
  [scanTaskManager dispose];
  [scanTaskManager release];

  [filterTaskManager dispose];
  [filterTaskManager release];
  
  [xmlWriteTaskManager dispose];
  [xmlWriteTaskManager release];

  [xmlReadTaskManager dispose];
  [xmlReadTaskManager release];

  [exportAsTextDialogControl release];
  [startWindowControl release];
  [preferencesPanelControl release];
  [filterSelectionPanelControl release];
  [filtersWindowControl release];
  [uniformTypeWindowControl release];

  [super dealloc];
}

- (BOOL) application:(NSApplication *)theApplication openFile:(NSString *)filename {
  BOOL isDirectory;
  BOOL targetExists = [NSFileManager.defaultManager fileExistsAtPath: filename
                                                         isDirectory: &isDirectory];
  
  if (targetExists) {
    if (isDirectory) {
      // Prevent window from showing if this action triggered the application to start
      showWelcomeWindow = NO;

      [self scanFolder: filename namedFilter: [self defaultNamedFilter]];
      // Loading is done asynchronously, so starting a scan is assumed a successful action
      return YES;
    }
    else if ([filename.pathExtension.lowercaseString isEqualToString: @"gpscan"]) {
      showWelcomeWindow = NO;

      [self loadScanDataFromFile: [NSURL fileURLWithPath: filename]];
      // Loading is done asynchronously, so starting a load is assumed a successful action
      return YES;
    }
  }
  return NO;
}

- (void) applicationWillFinishLaunching:(NSNotification *)notification {
  NSMenu  *mainMenu = NSApp.mainMenu;
  NSMenu  *fileMenu = [mainMenu itemWithTag: 100].submenu;
  NSMenu  *recentMenu = [fileMenu itemWithTag: 102].submenu;

  // Let Cocoa automatically manage the contents of the Recent Documents sub-menu. This relies on
  // an undocumented interface, as discovered by Jeff Johnson and shared on his blog:
  // http://lapcatsoftware.com/blog/2007/07/10/working-without-a-nib-part-5-open-recent-menu/
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wundeclared-selector"
  [recentMenu performSelector:@selector(_setMenuName:) withObject:@"NSRecentDocumentsMenu"];
#pragma clang diagnostic pop
}

- (void) applicationDidFinishLaunching:(NSNotification *)notification {
  NSApp.servicesProvider = self;
  
  if (showWelcomeWindow) {
    NSTimeInterval delay = [NSUserDefaults.standardUserDefaults
                            floatForKey: DelayBeforeWelcomeWindowAfterStartupKey];
    [self showWelcomeWindowAfterDelay: delay];
  }
}

- (void) applicationWillTerminate:(NSNotification *)notification {
  [FilterRepository.defaultFilterRepository storeUserCreatedFilters];
  [FilterTestRepository.defaultFilterTestRepository storeUserCreatedTests];
       
  [UniformTypeRanking.defaultUniformTypeRanking storeRanking];
       
  [self release];
}


// Service method (which handles requests from Finder's Services menu, amongst others)
- (void)scanFolder:(NSPasteboard *)pboard userData:(NSString *)userData error:(NSString **)error {
  NSLog(@"scanFolder:userData:error:");
  showWelcomeWindow = NO; // Do not automatically show welcome window

  NSURL  *fileUrl = [NSURL getFileURLFromPasteboard: pboard];
  if (fileUrl == nil) {
    *error = NSLocalizedString(@"Failed to get path from pasteboard", @"Error message");
    NSLog(@"%@", *error); // Also logging. Setting *error does not seem to work?
    return;
  }
  
  if (!fileUrl.isDirectory) {
    *error = NSLocalizedString(@"Expected a folder", @"Error message");
    NSLog(@"%@", *error); // Also logging. Setting *error does not seem to work?
    return;
  }

  [self scanFolder: fileUrl.path namedFilter: [self defaultNamedFilter]];
}


// Service method (which handles requests from Finder's Services menu, amongst others)
- (void)loadScanData:(NSPasteboard *)pboard userData:(NSString *)userData error:(NSString **)error {
  NSLog(@"loadScanData:userData:error:");
  showWelcomeWindow = NO; // Do not automatically show welcome window

  NSURL  *fileUrl = [NSURL getFileURLFromPasteboard: pboard];
  if (fileUrl == nil) {
    *error = NSLocalizedString(@"Failed to get path from pasteboard", @"Error message" );
    NSLog(@"%@", *error); // Also logging. Setting *error does not seem to work?
    return;
  }
  
  if (! [fileUrl.pathExtension.lowercaseString isEqualToString: @"gpscan"]) {
    *error = NSLocalizedString(@"Expected scandata file", @"Error message" );
    NSLog(@"%@", *error); // Also logging. Setting *error does not seem to work?
    return;
  }
  
  [self loadScanDataFromFile: fileUrl];
}

//----------------------------------------------------------------------------
// NSMenuItemValidation

- (BOOL) validateMenuItem:(NSMenuItem *)item {
  SEL  action = item.action;

  if (action == @selector(scanDirectoryView:) ||
      action == @selector(scanFilteredDirectoryView:) ||
      action == @selector(scanFilteredDirectoryView:) ||
      action == @selector(loadScanData:) ||
      action == @selector(openWebsite:) ||
      action == @selector(editPreferences:) ||
      action == @selector(editFilters:) ||
      action == @selector(editUniformTypeRanking:)) {
    return YES;
  }

  // The remaining actions require an active Directory View window
  NSWindow  *window = NSApplication.sharedApplication.mainWindow;
  BOOL  mainWindowIsDirectoryView =
    [window.windowController isMemberOfClass:[DirectoryViewControl class]];

  if (!mainWindowIsDirectoryView) {
    return NO;
  }

  if (action == @selector(duplicateDirectoryView:) ||
      action == @selector(twinDirectoryView:)  ||

      action == @selector(customizeToolbar:) ||

      action == @selector(saveScanData:) ||
      action == @selector(saveDirectoryViewImage:) ||
      action == @selector(saveScanDataAsText:) ||

      action == @selector(rescan:) ||
      action == @selector(rescanAll:) ||
      action == @selector(rescanVisible:) ||

      action == @selector(filterDirectoryView:)
  ) {
    return YES;
  }

  if (action == @selector(toggleToolbarShown:)) {
    item.title = window.toolbar.visible
       ? NSLocalizedStringFromTable(@"Hide Toolbar", @"Toolbar", @"Menu item")
       : NSLocalizedStringFromTable(@"Show Toolbar", @"Toolbar", @"Menu item");

    return YES;
  }

  if (action == @selector(toggleControlPanelShown:)) {
    item.title = ControlPanelControl.singletonInstance.isPanelShown
      ? NSLocalizedString(@"Hide Control Panel", @"Menu item")
      : NSLocalizedString(@"Show Control Panel", @"Menu item");

    return YES;
  }

  DirectoryViewControl  *dirViewControl = (DirectoryViewControl *)window.windowController;

  if (action == @selector(rescanSelected:)) {
    // Selection must be locked
    return dirViewControl.isSelectedFileLocked;
  }

  if (action == @selector(rescanWithMaskAsFilter:)) {
    // There should be a mask
    return dirViewControl.directoryViewControlSettings.displaySettings.fileItemMaskEnabled;
  }

  if (action == @selector(refresh:)) {
    // There must be a monitored change
    return dirViewControl.treeContext.numTreeChanges > 0;
  }


  if ([dirViewControl validateAction: action]) {
    return YES;
  }

  return NO;
}

//----------------------------------------------------------------------------

- (IBAction) scanDirectoryView:(id)sender {
  [self scanFolderSelectingFilter: NO];
}

- (IBAction) scanFilteredDirectoryView:(id)sender {
  [self scanFolderSelectingFilter: YES];
}

- (IBAction) refresh:(id)sender {
  DirectoryViewControl  *oldControl = NSApplication.sharedApplication.mainWindow.windowController;
  if (oldControl == nil) {
    return;
  }

  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  NSString  *rescanBehaviour = [userDefaults stringForKey: RescanBehaviourKey];
  if ([rescanBehaviour isEqualToString: RescanClosesOldWindow]) {
    [oldControl.window close];
  }

  TreeContext  *oldContext = oldControl.treeContext;
  [self refreshItem: oldContext.scanTree deriveFrom: oldControl];
}

- (IBAction) rescan:(id)sender {
  NSString  *rescanAction = [NSUserDefaults.standardUserDefaults
                             stringForKey: DefaultRescanActionKey];
  if ([rescanAction isEqualToString: RescanAll]) {
    [self rescanAll: sender];
  }
  else if ([rescanAction isEqualToString: RescanVisible]) {
    [self rescanVisible: sender];
  }
  else {
    NSLog(@"Unrecognized rescan action: %@", rescanAction);
  }
}

- (IBAction) rescanAll:(id)sender {
  DirectoryViewControl  *oldControl = NSApplication.sharedApplication.mainWindow.windowController;
  if (oldControl == nil) {
    return;
  }

  NSString  *rescanBehaviour = [NSUserDefaults.standardUserDefaults
                                stringForKey: RescanBehaviourKey];
  TreeContext  *oldContext = oldControl.treeContext;
  [self rescanItem: oldContext.scanTree deriveFrom: oldControl];

  if ([rescanBehaviour isEqualToString: RescanClosesOldWindow]) {
    [oldControl.window close];
  }
}

- (IBAction) rescanVisible:(id)sender {
  DirectoryViewControl  *oldControl = NSApplication.sharedApplication.mainWindow.windowController;
  if (oldControl == nil) {
    return;
  }
  
  ItemPathModelView  *pathModelView = oldControl.pathModelView;
  [self rescanItem: pathModelView.visibleTree deriveFrom: oldControl];
}

- (IBAction) rescanSelected:(id)sender {
  DirectoryViewControl  *oldControl = NSApplication.sharedApplication.mainWindow.windowController;
  if (oldControl == nil) {
    return;
  }
  
  ItemPathModelView  *pathModelView = oldControl.pathModelView;
  [self rescanItem: pathModelView.selectedFileItem deriveFrom: oldControl];
}

- (IBAction) rescanWithMaskAsFilter:(id)sender {
  DirectoryViewControl  *oldControl = NSApplication.sharedApplication.mainWindow.windowController;
  if (oldControl == nil) {
    return;
  }

  NSString  *rescanBehaviour = [NSUserDefaults.standardUserDefaults
                                stringForKey: RescanBehaviourKey];
  if ([rescanBehaviour isEqualToString: RescanClosesOldWindow]) {
    [oldControl.window close];
  }

  DirectoryViewControlSettings  *controlSettings = oldControl.directoryViewControlSettings;
  DirectoryViewDisplaySettings  *displaySettings = controlSettings.displaySettings;

  NSString  *maskName = displaySettings.maskName;
  Filter  *filterForMask = [FilterRepository.defaultFilterRepository filterForName: maskName];
  NamedFilter  *namedFilter = [NamedFilter namedFilter: filterForMask name: maskName];

  // Unset the mask
  displaySettings.maskName = nil;
  displaySettings.fileItemMaskEnabled = false;

  TreeContext  *oldContext = oldControl.treeContext;
  NSMutableArray  *unboundTests = [NSMutableArray arrayWithCapacity: 8];
  FilterSet  *filterSet =
    [oldContext.filterSet filterSetWithAddedNamedFilter: namedFilter
                                        packagesAsFiles: displaySettings.packagesAsFiles
                                           unboundTests: unboundTests];
  [MainMenuControl reportUnboundTests: unboundTests];

  [self rescanItem: oldContext.scanTree
        deriveFrom: oldControl
          settings: controlSettings
         filterSet: filterSet];
}


- (IBAction) filterDirectoryView:(id)sender {
  DirectoryViewControl  *oldControl = NSApplication.sharedApplication.mainWindow.windowController;
  DirectoryViewControlSettings  *settings = oldControl.directoryViewControlSettings;
  DirectoryViewDisplaySettings  *displaySettings = settings.displaySettings;

  NSArray  *selectedFilters = [self selectFilter: oldControl.nameOfActiveMask forNewScan: NO];
  if (selectedFilters == nil || selectedFilters.count == 0) {
    // User cancelled selection or selected "no filter", so abort
    return;
  }

  NSAssert(selectedFilters.count == 1, @"Expected only one filter");
  NamedFilter  *filter = selectedFilters[0];

  TreeContext  *oldContext = oldControl.treeContext;
  BOOL  packagesAsFiles = (oldContext.filterSet.numFilters > 0
                           // A filter is already active on the tree. Preserve the package setting
                           // to avoid inconsistencies in filter behaviour
                           ? oldContext.filterSet.packagesAsFiles
                           // Let filter behaviour for packages depend on current display setting
                           : displaySettings.packagesAsFiles);

  NSMutableArray  *unboundTests = [NSMutableArray arrayWithCapacity: 8];
  FilterSet  *filterSet = [oldContext.filterSet filterSetWithAddedNamedFilter: filter
                                                              packagesAsFiles: packagesAsFiles
                                                                 unboundTests: unboundTests];
  [MainMenuControl reportUnboundTests: unboundTests];

  if ([filter.name isEqualToString: displaySettings.maskName]) {
    // Don't retain the mask if the filter has the same name. It is likely that the filter is the
    // same as the mask, or if not, is at least a modified version of it. It therefore does not make
    // sense to retain the mask. This is only confusing.
    displaySettings.maskName = nil;
  }

  ItemPathModel  *pathModel = oldControl.pathModelView.pathModel;
  DerivedDirViewWindowCreator  *windowCreator =
    [[[DerivedDirViewWindowCreator alloc] initWithWindowManager: windowManager
                                                     targetPath: pathModel
                                                       settings: settings] autorelease];

  FilterTaskInput  *input = [[[FilterTaskInput alloc] initWithTreeContext: oldContext
                                                                filterSet: filterSet]
                             autorelease];

  [filterTaskManager asynchronouslyRunTaskWithInput: input
                                           callback: windowCreator
                                           selector: @selector(createWindowForTree:)];
}


- (IBAction) duplicateDirectoryView:(id)sender {
  [self duplicateCurrentWindowSharingPath: NO];
}

- (IBAction) twinDirectoryView:(id)sender {
  [self duplicateCurrentWindowSharingPath: YES];
}


- (IBAction) saveScanData:(id)sender {
  NSSavePanel  *savePanel = [NSSavePanel savePanel];
  savePanel.allowedFileTypes = @[@"gpscan"];
  [savePanel setTitle: NSLocalizedString(@"Save scan data", @"Title of save panel") ];

  [self saveScanDataToFile: savePanel usingTaskManager: xmlWriteTaskManager options: nil];
}


- (IBAction) loadScanData:(id)sender {
  NSOpenPanel  *openPanel = [NSOpenPanel openPanel];
  openPanel.allowedFileTypes = @[@"xml", @"gpscan"];

  [openPanel setTitle: NSLocalizedString(@"Load scan data", @"Title of load panel") ];
  
  if ([openPanel runModal] == NSModalResponseOK) {
    NSURL  *sourceURL = openPanel.URL;
    if (sourceURL.fileURL) {
      [self loadScanDataFromFile: sourceURL];
    } else {
      NSLog(@"Source '%@' is not a file?", sourceURL); 
    }
  }
}


- (IBAction) saveScanDataAsText:(id)sender {
  if (exportAsTextDialogControl == nil) {
    exportAsTextDialogControl = [[ExportAsTextDialogControl alloc] init];
  }

  NSWindow  *window = exportAsTextDialogControl.window;
  NSInteger  status = [NSApp runModalForWindow: window];
  [window close];

  if (status != NSModalResponseStop) {
    return;
  }

  NSSavePanel  *savePanel = [NSSavePanel savePanel];
  savePanel.allowedFileTypes = @[@"txt", @"text", @"tsv"];
  [savePanel setTitle: NSLocalizedString(@"Export scan data as text", @"Title of save panel") ];

  [self saveScanDataToFile: savePanel
          usingTaskManager: rawWriteTaskManager
                   options: [exportAsTextDialogControl rawTreeWriterOptions]];
}


- (IBAction) saveDirectoryViewImage:(id)sender {
  DirectoryViewControl  *dirViewControl = 
    NSApplication.sharedApplication.mainWindow.windowController;

  [[[SaveImageDialogControl alloc] initWithDirectoryViewControl: dirViewControl] autorelease];
}

- (IBAction) editPreferences:(id)sender {
  if (preferencesPanelControl == nil) {
    // Lazily create the panel
    preferencesPanelControl = [[PreferencesPanelControl alloc] init];
    
    [preferencesPanelControl.window center];
  }

  [preferencesPanelControl.window makeKeyAndOrderFront: self];
}

- (IBAction) editFilters:(id)sender {
  if (filtersWindowControl == nil) {
    // Lazily create the window
    filtersWindowControl = [[FiltersWindowControl alloc] init];

    // Initially center it, subsequently keep position as chosen by user
    [filtersWindowControl.window center];
  }
  
  [filtersWindowControl.window makeKeyAndOrderFront: self];
}

- (IBAction) editUniformTypeRanking:(id)sender {
  if (uniformTypeWindowControl == nil) {
    // Lazily construct the window
    uniformTypeWindowControl = [[UniformTypeRankingWindowControl alloc] init];
  }
  
  // [uniformTypeWindowControl refreshTypeList];
  [uniformTypeWindowControl.window makeKeyAndOrderFront: self];
}


- (IBAction) toggleToolbarShown:(id)sender {
  [NSApplication.sharedApplication.mainWindow toggleToolbarShown: sender];
}

- (IBAction) customizeToolbar:(id)sender {
  [NSApplication.sharedApplication.mainWindow runToolbarCustomizationPalette: sender];
}

- (IBAction) toggleControlPanelShown:(id)sender {
  ControlPanelControl  *cpc = ControlPanelControl.singletonInstance;

  if (cpc.isPanelShown) {
    [cpc hidePanel];
  } else {
    [cpc showPanel];
  }
}

- (IBAction) openWebsite:(id)sender {
  NSBundle  *bundle = NSBundle.mainBundle;
  NSURL  *url = [NSURL URLWithString: [bundle objectForInfoDictionaryKey: @"GPWebsiteURL"]];
  [NSWorkspace.sharedWorkspace openURL: url];
}

- (void) scanFolder:(NSString *)path {
  [self scanFolder: path namedFilter: [self defaultNamedFilter]];
}

@end // @implementation MainMenuControl


@implementation MainMenuControl (PrivateMethods)

- (void) showWelcomeWindowAfterDelay:(NSTimeInterval) delay {
  showWelcomeWindow = YES;
  if (delay == 0) {
    [self showWelcomeWindow];
  } else if (delay > 0) {
    // Set a watchdog. If it times out before service activity is detected, show welcome window
    [NSTimer scheduledTimerWithTimeInterval: delay
                                     target: self
                                   selector: @selector(showWelcomeWindowAfterDelay)
                                   userInfo: nil
                                    repeats: NO];
  }
}

// Called by watchdog set by showWelcomeWindowAfterDelay:. Not intended to be invoked elsewhere.
- (void) showWelcomeWindowAfterDelay {
  // Check flag again. It may have changed after the watchdog was started.
  if (!showWelcomeWindow) {
    // Do not show window after all. This is used to prevent showing the window when the
    // application was started via a service invocation or dock drop. It is needed because the
    // actual request is only received after the control has been constructed. During its
    // construction, the application does not yet know how it was started and whether it should show
    // the welcome window.
    return;
  }

  [self showWelcomeWindow];
}

- (void) showWelcomeWindow {
  if (startWindowControl == nil) {
    startWindowControl = [[StartWindowControl alloc] initWithMainMenuControl: self];
  } else {
    [startWindowControl changeTagLine];
  }

  [startWindowControl showWindow: nil];
}

- (void) hideWelcomeWindow {
  if (startWindowControl != nil && startWindowControl.window.visible) {
    [startWindowControl.window close];
  }
}

- (void) hideControlPanel {
  [[ControlPanelControl singletonInstance] hidePanel];
}

- (void) scanFolderSelectingFilter:(BOOL)selectFilter {
  NSOpenPanel  *openPanel = [NSOpenPanel openPanel];
  [openPanel setCanChooseFiles: NO];
  [openPanel setCanChooseDirectories: YES];
  [openPanel setAllowsMultipleSelection: NO];

  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  DrawItemsEnum  drawItems = [TreeDrawerBaseSettings enumForDrawItemsName:
                              [userDefaults stringForKey: DefaultDrawItemsKey]];
  openPanel.treatsFilePackagesAsDirectories = drawItems == DRAW_FILES;

  [openPanel setTitle: NSLocalizedString(@"Scan folder", @"Title of open panel")];
  [openPanel setPrompt: NSLocalizedString(@"Scan", @"Prompt in open panel")];

  if ([openPanel runModal] != NSModalResponseOK) {
    // User cancelled scan
    [self checkShowWelcomeWindow: YES];

    return;
  } 

  NSURL  *targetURL = openPanel.URL;
  if (!targetURL.fileURL) {
    NSLog(@"URL '%@' is not a file?", targetURL);
    return;
  }

  if (selectFilter) {
    NSArray  *filters = [self selectFilter: nil forNewScan: YES];

    if (filters == nil) {
      // User cancelled filter selection. Abort scanning.
      return;
    }

    [self scanFolder: targetURL.path namedFilters: filters];
  } else {
    [self scanFolder: targetURL.path namedFilter: [self defaultNamedFilter]];
  }
}

- (void) scanFolder:(NSString *)path namedFilter:(NamedFilter *)namedFilter {
  [self scanFolder: path namedFilters: (namedFilter != nil) ? @[namedFilter] : nil];
}

- (void) scanFolder:(NSString *)path namedFilters:(NSArray *)filters {
  FilterSet  *filterSet = nil;

  if (filters != nil && filters.count > 0) {
    NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
    DrawItemsEnum  drawItems = [TreeDrawerBaseSettings enumForDrawItemsName:
                                [userDefaults stringForKey: DefaultDrawItemsKey]];
    BOOL  packagesAsFiles = drawItems != DRAW_FILES;

    NSMutableArray  *unboundFilters = [NSMutableArray arrayWithCapacity: 8];
    NSMutableArray  *unboundTests = [NSMutableArray arrayWithCapacity: 8];
    filterSet = [FilterSet filterSetWithNamedFilters: filters
                                     packagesAsFiles: packagesAsFiles
                                      unboundFilters: unboundFilters
                                        unboundTests: unboundTests];
    [MainMenuControl reportUnboundFilters: unboundFilters];
    [MainMenuControl reportUnboundTests: unboundTests];
  }

  [self scanFolder: path filterSet: filterSet];
}

- (void) scanFolder:(NSString *)path filterSet:(FilterSet *)filterSet {
  [self hideWelcomeWindow]; // Auto-close window if it was showing

  NSString  *fileSizeMeasure = [NSUserDefaults.standardUserDefaults
                                stringForKey: FileSizeMeasureKey];

  FreshDirViewWindowCreator  *windowCreator =
    [[[FreshDirViewWindowCreator alloc] initWithWindowManager: windowManager] autorelease];
  ScanTaskInput  *input = [[[ScanTaskInput alloc] initWithPath: path
                                               fileSizeMeasure: fileSizeMeasure
                                                     filterSet: filterSet] autorelease];

  windowCreator.addToRecentScans = YES;
  [scanTaskManager asynchronouslyRunTaskWithInput: input
                                         callback: windowCreator
                                         selector: @selector(createWindowForScanResult:)];
}

- (void) refreshItem:(DirectoryItem *)item
          deriveFrom:(DirectoryViewControl *)oldControl {
  TreeContext  *oldContext = oldControl.treeContext;
  ItemPathModel  *pathModel = oldControl.pathModelView.pathModel;

  DirectoryViewControlSettings  *settings = oldControl.directoryViewControlSettings;
  DerivedDirViewWindowCreator  *windowCreator = [
    [[DerivedDirViewWindowCreator alloc] initWithWindowManager: windowManager
                                                    targetPath: pathModel
                                                      settings: settings]
    autorelease];

  // In contrast to the rescanItem:deriveFrom: methods, never update the filter set that is used.
  // As only parts of the tree is rescanned, any changes to the filter would only be partially
  // applied, which would result in inconsistencies.

  ScanTaskInput  *input = [[[ScanTaskInput alloc] initWithTreeSource: oldContext.scanTree
                                                     fileSizeMeasure: oldContext.fileSizeMeasure
                                                           filterSet: oldContext.filterSet]
                           autorelease];

  [scanTaskManager asynchronouslyRunTaskWithInput: input
                                         callback: windowCreator
                                         selector: @selector(createWindowForScanResult:)];
}

/* Used to implement various Rescan commands. The new view is derived from the
 * current/old control, and its settings are matched as much as possible.
 */
- (void) rescanItem:(FileItem *)item 
         deriveFrom:(DirectoryViewControl *)oldControl {
  [self rescanItem: item
        deriveFrom: oldControl
          settings: oldControl.directoryViewControlSettings
         filterSet: oldControl.treeContext.filterSet];
}

- (void) rescanItem:(FileItem *)item
         deriveFrom:(DirectoryViewControl *)oldControl
           settings:(DirectoryViewControlSettings *)controlSettings
          filterSet:(FilterSet *)filterSet {
  // Make sure to always scan a directory.
  if (!item.isDirectory) {
    item = item.parentDirectory;
  }

  TreeContext  *oldContext = oldControl.treeContext;
  ItemPathModel  *pathModel = oldControl.pathModelView.pathModel;
    
  DerivedDirViewWindowCreator  *windowCreator =
    [[[DerivedDirViewWindowCreator alloc] initWithWindowManager: windowManager
                                                     targetPath: pathModel
                                                       settings: controlSettings] autorelease];

  filterSet = [MainMenuControl updateFiltersIfNeeded: filterSet];

  ScanTaskInput  *input = [
    [[ScanTaskInput alloc] initWithPath: item.systemPath
                        fileSizeMeasure: oldContext.fileSizeMeasure
                              filterSet: filterSet
                             treeSource: nil]
    autorelease];

  [scanTaskManager asynchronouslyRunTaskWithInput: input
                                         callback: windowCreator
                                         selector: @selector(createWindowForScanResult:)];
}


- (void) loadScanDataFromFile:(NSURL *)sourceUrl {
  [self hideWelcomeWindow]; // Auto-close window if it was showing

  ReadTaskInput  *input = [[[ReadTaskInput alloc] initWithSourceUrl: sourceUrl] autorelease];

  ReadTaskCallback  *callback = 
    [[[ReadTaskCallback alloc] initWithWindowManager: windowManager readTaskInput: input]
     autorelease];
    
  [xmlReadTaskManager asynchronouslyRunTaskWithInput: input
                                         callback: callback
                                         selector: @selector(readTaskCompleted:)];
}

- (void) saveScanDataToFile:(NSSavePanel *)savePanel
           usingTaskManager:(VisibleAsynchronousTaskManager *)taskManager
                    options:(id)options {
  DirectoryViewControl  *dirViewControl =
    NSApplication.sharedApplication.mainWindow.windowController;

  if ([savePanel runModal] == NSModalResponseOK) {
    NSURL  *destURL = savePanel.URL;

    if (destURL.fileURL) {
      WriteTaskInput  *input =
        [[[WriteTaskInput alloc] initWithAnnotatedTreeContext: [dirViewControl annotatedTreeContext]
                                                         path: destURL
                                                      options: options]
       autorelease];

      WriteTaskCallback  *callback =
        [[[WriteTaskCallback alloc] initWithWriteTaskInput: input] autorelease];

      [taskManager asynchronouslyRunTaskWithInput: input
                                         callback: callback
                                         selector: @selector(writeTaskCompleted:)];
    } else {
      NSLog(@"Destination '%@' is not a file?", destURL);
    }
  }
}


- (void) duplicateCurrentWindowSharingPath:(BOOL)sharePathModel {
  DirectoryViewControl  *oldControl = 
    NSApplication.sharedApplication.mainWindow.windowController;

  // Share or clone the path model.
  ItemPathModel  *pathModel = oldControl.pathModelView.pathModel;

  if (!sharePathModel) {
    pathModel = [[pathModel copy] autorelease];
  }

  DirectoryViewControlSettings  *oldSettings = oldControl.directoryViewControlSettings;
  DirectoryViewControl  *newControl =
    [[[DirectoryViewControl alloc] initWithAnnotatedTreeContext: oldControl.annotatedTreeContext
                                                      pathModel: pathModel
                                                       settings: oldSettings] autorelease];

  // Force loading (and showing) of the window.
  [windowManager addWindow: newControl.window usingTitle: oldControl.window.title];
}


- (NSArray *)selectFilter:(NSString *)initialSelection forNewScan:(BOOL)forNewScan {
  if (filterSelectionPanelControl == nil) {
    filterSelectionPanelControl = [[FilterSelectionPanelControl alloc] init];
  }

  [filterSelectionPanelControl selectFilterNamed: (initialSelection != nil
                                                   ? initialSelection : NoneFilter)];

  // Note: Ensure window is loaded before changing enabled status of its controls
  NSWindow  *selectFilterWindow = filterSelectionPanelControl.window;

  NSString  *defaultFilterName = [NSUserDefaults.standardUserDefaults objectForKey: ScanFilterKey];
  BOOL  canApplyDefaultFilter = forNewScan && ![defaultFilterName isEqualToString: NoneFilter];
  [filterSelectionPanelControl enableApplyDefaultFilterOption: canApplyDefaultFilter];
  
  NSInteger  status = [NSApp runModalForWindow: selectFilterWindow];
  [selectFilterWindow close];
  
  if (status != NSModalResponseStop) {
    // User aborted selection
    return nil;
  }

  NSMutableArray  *filters = [NSMutableArray arrayWithCapacity: 2];
  if (filterSelectionPanelControl.applyDefaultFilter) {
    [filters addObject: [self defaultNamedFilter]];
  }

  NamedFilter  *selectedFilter = filterSelectionPanelControl.selectedNamedFilter;
  if (selectedFilter != nil
      // Do not add the same filter twice
      && (filters.count == 0 || selectedFilter.name != defaultFilterName)) {
    [filters addObject: filterSelectionPanelControl.selectedNamedFilter];
  }

  return filters;
}

- (NamedFilter *)defaultNamedFilter {
  NSString  *name = [NSUserDefaults.standardUserDefaults objectForKey: ScanFilterKey];
  if ([name isEqualToString: NoneFilter]) {
    return nil;
  }

  Filter  *filter = FilterRepository.defaultFilterRepository.filtersByName[name];
  return [[[NamedFilter alloc] initWithFilter: filter
                                         name: name
                                     implicit: YES] autorelease];
}

+ (FilterSet *)updateFiltersIfNeeded:(FilterSet *)filterSet {
  if ([NSUserDefaults.standardUserDefaults boolForKey: UpdateFiltersBeforeUse]) {
    NSMutableArray  *unboundFilters = [NSMutableArray arrayWithCapacity: 8];
    NSMutableArray  *unboundTests = [NSMutableArray arrayWithCapacity: 8];
    filterSet = [filterSet updatedFilterSetUnboundFilters: unboundFilters
                                             unboundTests: unboundTests];
    [MainMenuControl reportUnboundFilters: unboundFilters];
    [MainMenuControl reportUnboundTests: unboundTests];
  }

  return filterSet;
}

+ (void) reportUnbound:(NSArray *)unboundNames
         messageFormat:(NSString *)format
              infoText:(NSString *)infoText {
  if (unboundNames.count == 0) {
    // No unbound items. Nothing to report.
    return;
  }

  NSAlert *alert = [[[NSAlert alloc] init] autorelease];

  // Quote the names
  NSMutableArray  *quotedNames = [NSMutableArray arrayWithCapacity: unboundNames.count];
  for (NSString *name in [unboundNames objectEnumerator]) {
    [quotedNames addObject: [NSString stringWithFormat: @"\"%@\"", name]];
  }
    
  NSString  *nameList = [LocalizableStrings localizedAndEnumerationString: quotedNames];

  [alert addButtonWithTitle: OK_BUTTON_TITLE];
  alert.messageText = [NSString stringWithFormat: format, nameList];
  alert.informativeText = infoText;

  [alert runModal];
}


+ (NSString *)windowTitleForDirectoryView:(DirectoryViewControl *)control {
  TreeContext  *treeContext = control.treeContext;
  NSString  *scanPath = treeContext.scanTree.path;

  NSString  *scanTime = treeContext.stringForScanTime;
  FilterSet  *filterSet = treeContext.filterSet;

  if (filterSet.numFilters == 0) {
    return [NSString stringWithFormat: @"%@ @ %@", scanPath, scanTime];
  }
  return [NSString stringWithFormat: @"%@ - %@ @ %@", scanPath, filterSet.description, scanTime];
}

- (void) viewWillOpen:(NSNotification *)notification {
  viewCount++;
  NSLog(@"viewCount = %d, viewTaskCount = %d", viewCount, viewTaskCount);
}

- (void) viewWillClose:(NSNotification *)notification {
  viewCount--;
  NSLog(@"viewCount = %d, viewTaskCount = %d", viewCount, viewTaskCount);
  [self checkShowWelcomeWindow: YES];
}

- (void) viewProducingTaskScheduled:(NSNotification *)notification {
  viewTaskCount++;
  NSLog(@"viewCount = %d, viewTaskCount = %d", viewCount, viewTaskCount);
}

- (void) viewProducingTaskCompleted:(NSNotification *)notification {
  viewTaskCount--;
  NSLog(@"viewCount = %d, viewTaskCount = %d", viewCount, viewTaskCount);
  [self checkShowWelcomeWindow: NO];
}

// Note: This method may be called from another thead than the main one.
- (void) checkShowWelcomeWindow:(BOOL)allowAutoQuit {
  if (viewCount > 0) {
    return;
  }

  // A private helper method is used instead of invoking hidePanel directly on the ControlPanel
  // singleton. The latter results in a crash when the singleton instance did not yet exist.
  [self performSelectorOnMainThread: @selector(hideControlPanel)
                         withObject: nil
                      waitUntilDone: NO];

  if (viewTaskCount > 0) {
    return;
  }

  NSString  *action = [NSUserDefaults.standardUserDefaults stringForKey: NoViewsBehaviourKey];
  if ([action isEqualToString: AfterClosingLastViewQuit]) {
    if (allowAutoQuit) {
      NSLog(@"Auto-quitting application after last view has closed");
      [NSApplication.sharedApplication performSelectorOnMainThread: @selector(terminate:)
                                                        withObject: nil
                                                     waitUntilDone: NO];
    }
  }
  else if ([action isEqualToString: AfterClosingLastViewShowWelcome]) {
    [self performSelectorOnMainThread: @selector(showWelcomeWindow)
                           withObject: nil
                        waitUntilDone: NO];
  }
  else if ([action isEqualToString: AfterClosingLastViewDoNothing]) {
    // void
  }
  else {
    NSLog(@"Unrecognized action: %@", action);
  }
}

@end // @implementation MainMenuControl (PrivateMethods)


@implementation ReadTaskCallback

- (instancetype) initWithWindowManager:(WindowManager *)windowManagerVal
                         readTaskInput:(ReadTaskInput *)taskInputVal {
  if (self = [super init]) {
    windowManager = [windowManagerVal retain];
    taskInput = [taskInputVal retain];
  }
  
  return self;
}

- (void) dealloc {
  [windowManager release];
  [taskInput release];

  [super dealloc];
}


- (void) readTaskCompleted:(TreeReader *)treeReader {
  if (treeReader.aborted) {
    // Reading was aborted. Silently ignore.
    return;
  }
  else if (treeReader.error) {
    NSAlert *alert = [[[NSAlert alloc] init] autorelease];

    NSString  *format = 
      NSLocalizedString(@"Failed to load the scan data from \"%@\"",
                        @"Alert message (with filename arg)");

    [alert addButtonWithTitle: OK_BUTTON_TITLE];
    alert.messageText = [NSString stringWithFormat: format, taskInput.sourceUrl.lastPathComponent];
    alert.informativeText = treeReader.error.localizedDescription;

    [alert runModal];
  }
  else {
    AnnotatedTreeContext  *tree = treeReader.annotatedTreeContext;
    NSAssert(tree != nil, @"Unexpected state.");

    // Do not report unbound tests as there is no direct impact. Firstly, the state of the read scan
    // tree does not depend on the restored filter. Secondly, the filter description as reported in
    // the comments is also restored from file and therefore also not impacted.
    //
    // There is an impact when rescanning the resulting view, but this will then be reported at that
    // moment.
    //
    // There is no impact when filtering the resulting view. Although the filter is less specific
    // than it was (because it is missing one or more filter tests), there are no nodes anymore in
    // the scan tree that are impacted, as these have all been filtered out already.
    //[MainMenuControl reportUnboundTests: [treeReader unboundFilterTests]];
    
    FreshDirViewWindowCreator  *windowCreator =
      [[[FreshDirViewWindowCreator alloc] initWithWindowManager: windowManager] autorelease];
      
    [windowCreator createWindowForAnnotatedTree: tree];
  }
}

@end // @interface ReadTaskCallback


@implementation WriteTaskCallback

- (instancetype) initWithWriteTaskInput:(WriteTaskInput *)taskInputVal {
  if (self = [super init]) {
    taskInput = [taskInputVal retain];
  }
  
  return self;
}

- (void) dealloc {
  [taskInput release];

  [super dealloc];
}


- (void) writeTaskCompleted:(id)result {
  NSAlert  *alert = [[[NSAlert alloc] init] autorelease];
  NSString  *msgFormat = nil;

  if (result == SuccessfulVoidResult) {
    alert.alertStyle = NSAlertStyleInformational;
    
    msgFormat = NSLocalizedString(@"Successfully saved the scan data to \"%@\"",
                                  @"Alert message (with filename arg)");
  }
  else if (result == nil) {
    // Writing was aborted
    msgFormat = NSLocalizedString(@"Aborted saving the scan data to \"%@\"",
                                  @"Alert message (with filename arg)");
    [alert setInformativeText: 
       NSLocalizedString(@"The resulting file is valid but incomplete",
                         @"Alert informative text")];
  }
  else {
    // An error occurred while writing
    msgFormat = NSLocalizedString( @"Failed to save the scan data to \"%@\"", 
                                   @"Alert message (with filename arg)" );
    alert.informativeText = ((NSError *)result).localizedDescription;
  }

  alert.messageText = [NSString stringWithFormat: msgFormat, taskInput.path.lastPathComponent];
  
  [alert addButtonWithTitle: OK_BUTTON_TITLE];
  [alert runModal];
}

@end // @interface WriteTaskCallback


@implementation FreshDirViewWindowCreator

- (instancetype) initWithWindowManager:(WindowManager *)windowManagerVal {
  if (self = [super init]) {
    windowManager = [windowManagerVal retain];
    self.addToRecentScans = NO;
  }
  return self;
}

- (void) dealloc {
  [windowManager release];
  
  [super dealloc];
}


- (DirectoryViewControl *)createWindowForScanResult:(ScanTaskOutput *)scanResult {
  DirectoryViewControl *control = [self createWindowForTree: scanResult.treeContext];

  if (scanResult.alert) {
    NSAlert  *alert = [[[NSAlert alloc] init] autorelease];
    alert.messageText = scanResult.alert.messageText;
    alert.informativeText = scanResult.alert.informativeText;
    [alert addButtonWithTitle: OK_BUTTON_TITLE];

    if (control != nil) {
      [control showInformativeAlert: alert];
    } else {
      [alert runModal];
    }
  }

  return control;
}

- (DirectoryViewControl *)createWindowForTree:(TreeContext *)treeContext {
  return
    [self createWindowForAnnotatedTree: [AnnotatedTreeContext annotatedTreeContext: treeContext]];
}

- (DirectoryViewControl *)createWindowForAnnotatedTree:(AnnotatedTreeContext *)annTreeContext {
  if (annTreeContext == nil) {
    // Reading failed or cancelled. Don't create a window.
    return nil;
  }
  
  if (self.addToRecentScans) {
    // The scan was successful, so add it to the "Recent Scans" list
    NSString  *scanPath = annTreeContext.treeContext.scanTree.systemPath;
    [NSDocumentController.sharedDocumentController
      noteNewRecentDocumentURL: [NSURL fileURLWithPath: scanPath]];
  }

  DirectoryViewControl  *dirViewControl =
    [self createDirectoryViewControlForAnnotatedTree: annTreeContext];
  
  NSString  *title = [MainMenuControl windowTitleForDirectoryView: dirViewControl];
  
  // Force loading (and showing) of the window.
  [windowManager addWindow: dirViewControl.window usingTitle: title];

  return dirViewControl;
}

- (DirectoryViewControl *)createDirectoryViewControlForAnnotatedTree:
                            (AnnotatedTreeContext *)annTreeContext {
  return [[[DirectoryViewControl alloc] initWithAnnotatedTreeContext: annTreeContext] autorelease];
}

@end // @implementation FreshDirViewWindowCreator


@implementation DerivedDirViewWindowCreator

// Overrides designated initialiser.
- (instancetype) initWithWindowManager:(WindowManager *)windowManagerVal {
  NSAssert(NO, @"Use initWithWindowManager:targetPath:settings instead.");
  return [self initWithWindowManager: nil targetPath: nil settings: nil];
}

- (instancetype) initWithWindowManager:(WindowManager *)windowManagerVal
                            targetPath:(ItemPathModel *)targetPathVal
                              settings:(DirectoryViewControlSettings *)settingsVal {
         
  if (self = [super initWithWindowManager: windowManagerVal]) {
    targetPath = [targetPathVal retain];
    // Note: The state of "targetPath" may change during scanning/filtering (which happens in the
    // background). This is okay and even desired. When the callback occurs the path in the new
    // window will match the current path in the original window.
     
    settings = [settingsVal retain];
  }
  return self;
}

- (void) dealloc {
  [targetPath release];
  [settings release];
  
  [super dealloc];
}


- (DirectoryViewControl *)createDirectoryViewControlForAnnotatedTree:
                            (AnnotatedTreeContext *)annTreeContext {
  // Try to match the subjectPath to the targetPath
  ItemPathModel  *subjectPath = [ItemPathModel pathWithTreeContext: annTreeContext.treeContext];

  [subjectPath suppressVisibleTreeChangedNotifications: YES];

  FileItem  *itemToSelect = nil;

  BOOL  insideTargetScanTree = NO;
  BOOL  insideSubjectScanTree = NO;
  BOOL  insideVisibleTree = NO;
  BOOL  hasVisibleItems = NO;
  
  NSString  *subjectScanTreePath = subjectPath.scanTree.path;
  
  for (FileItem *targetItem in [targetPath.fileItemPath objectEnumerator]) {
    if (insideSubjectScanTree) {
      // Only try to extend the visible path once we are inside the subject's scan tree, as this is
      // where the path starts. (Also, we need to be in the target's scan tree as well, but this is
      // implied).
      if ([subjectPath extendVisiblePathToSimilarFileItem: targetItem]) {
        if (!insideVisibleTree) {
          [subjectPath moveVisibleTreeDown];
        }
        else {
          hasVisibleItems = YES;
        }
      }
      else {
        // Failure to match, so should stop matching remainder of path.
        break;
      }
    }
    if (itemToSelect == nil && targetItem == targetPath.selectedFileItem) {
      // Found the selected item. It is the path's current end point. 
      itemToSelect = subjectPath.lastFileItem;
    }
    if (!insideVisibleTree && targetItem == targetPath.visibleTree) {
      // The remainder of this path can remain visible.
      insideVisibleTree = YES;
    }
    if (!insideTargetScanTree && targetItem == targetPath.scanTree) {
      insideTargetScanTree = YES;
    }
    if (insideTargetScanTree && [targetItem.path isEqualToString: subjectScanTreePath]) {
      // We can now start extending "subjectPath" to match "targetPath". 
      insideSubjectScanTree = YES;
    }
  }

  if (hasVisibleItems) {
    [subjectPath setVisiblePathLocking: YES];
  }
  
  if (itemToSelect != nil) {
    // Match the selection to that of the original path. 
    [subjectPath selectFileItem: itemToSelect];
  }
  else {
    // Did not manage to match the new path all the way up to the selected item in the original
    // path. The selected item of the new path can therefore be set to the path endpoint (as that is
    // the closest it can come to matching the old selection).
    [subjectPath selectFileItem: subjectPath.lastFileItem];
  }
        
  [subjectPath suppressVisibleTreeChangedNotifications: NO];

  return [[[DirectoryViewControl alloc] initWithAnnotatedTreeContext: annTreeContext
                                                           pathModel: subjectPath
                                                            settings: settings] autorelease];
}

@end // @implementation DerivedDirViewWindowCreator
