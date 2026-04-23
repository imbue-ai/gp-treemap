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

#import "DirectoryViewControl.h"

@import Quartz; // Quartz framework provides the QLPreviewPanel public API

#import "PlainFileItem.h"
#import "DirectoryItem.h"
#import "DirectoryView.h"
#import "ItemPathModel.h"
#import "ItemPathModelView.h"
#import "TreeContext.h"
#import "AnnotatedTreeContext.h"

#import "DirectoryViewControlSettings.h"
#import "DirectoryViewDisplaySettings.h"
#import "ControlPanelControl.h"
#import "PreferencesPanelControl.h"
#import "MainMenuControl.h"

#import "TreeDrawerSettings.h"
#import "ControlConstants.h"

#import "ItemNameTest.h"
#import "StringContainmentTest.h"
#import "SelectiveItemTest.h"


NSString  *DeleteNothing = @"delete nothing";
NSString  *OnlyDeleteFiles = @"only delete files";
NSString  *DeleteFilesAndFolders = @"delete files and folders";

NSString  *ViewWillOpenEvent = @"viewWillOpen";
NSString  *ViewWillCloseEvent = @"viewWillClose";


#define NOTE_IT_MAY_NOT_EXIST_ANYMORE \
  NSLocalizedString(\
    @"A possible reason is that it does not exist anymore", \
    @"Alert message (Note: 'it' can refer to a file or a folder)")


@interface DirectoryViewControl () <QLPreviewPanelDataSource, QLPreviewPanelDelegate> {
}

@property (strong) QLPreviewPanel *previewPanel;

@end

@interface DirectoryViewControl (PrivateMethods)

@property (nonatomic, readonly) BOOL canOpenSelectedFile;
@property (nonatomic, readonly) BOOL canPreviewSelectedFile;
@property (nonatomic, readonly) BOOL canRevealSelectedFile;
@property (nonatomic, readonly) BOOL canDeleteSelectedFile;
@property (nonatomic, readonly) BOOL canCopySelectedPathToPasteboard;

- (void) deleteSelectedFile;

- (void) selectedItemChanged:(NSNotification *)notification;
- (void) visibleTreeChanged:(NSNotification *)notification;
- (void) visiblePathLockingChanged:(NSNotification *)notification;

- (void) commentsChanged:(NSNotification *)notification;

- (void) displaySettingsChanged:(NSNotification *)notification;
- (void) propagateDisplaySettings;

- (void) displayFocusChanged:(NSNotification *)notification;

- (void) updateSelectionInStatusbar:(NSString *)itemSizeString;
- (void) showStatusUpdateMessage:(NSString *)message;
- (void) validateControls;

- (void) updateFileDeletionSupport;

- (void) fileSizeUnitSystemChanged;

- (void) openFile:(FileItem *)fileItem withApplication:(NSURL *)appUrl;
@end


@interface DirectoryViewPreviewItem : NSObject <QLPreviewItem> {
  NSArray  *pathToSelectedItem;
}

// Overrides designated initialiser
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithPathToSelectedItem:(NSArray *)pathToSelectedItem NS_DESIGNATED_INITIALIZER;

@property (nonatomic, readonly, copy) NSArray *pathToSelectedItem;
@property (nonatomic, readonly, strong) FileItem *selectedItem;

@end


@implementation DirectoryViewControl

- (instancetype) initWithAnnotatedTreeContext:(AnnotatedTreeContext *)annTreeContext {
  ItemPathModel  *pathModel = 
    [[[ItemPathModel alloc] initWithTreeContext: annTreeContext.treeContext] autorelease];

  // Default settings
  DirectoryViewControlSettings  *defaultSettings =
    [[[DirectoryViewControlSettings alloc] init] autorelease];

  return [self initWithAnnotatedTreeContext: annTreeContext
                                  pathModel: pathModel
                                   settings: defaultSettings];
}


- (instancetype) initWithAnnotatedTreeContext:(AnnotatedTreeContext *)annTreeContext
                                    pathModel:(ItemPathModel *)pathModel
                                     settings:(DirectoryViewControlSettings *)settings {
  if (self = [super initWithWindow: nil]) {
    treeContext = [annTreeContext.treeContext retain];
    NSAssert(pathModel.volumeTree == treeContext.volumeTree, @"Tree mismatch");
    _comments = [annTreeContext.comments retain];
    
    pathModelView = [[ItemPathModelView alloc] initWithPathModel: pathModel];
    initialSettings = [settings retain];
    displaySettings = [initialSettings.displaySettings retain];
    
    scanPathName = [treeContext.scanTree.path retain];
    invisiblePathName = nil;
    statusMessage = nil;
  }

  // The control is responsible for itself. It auto-releases when the window closes.
  return [self retain];
}


- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];
  
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  [userDefaults removeObserver: self forKeyPath: FileDeletionTargetsKey];
  [userDefaults removeObserver: self forKeyPath: ConfirmFileDeletionKey];
  [userDefaults removeObserver: self forKeyPath: FileSizeUnitSystemKey];
  
  [treeContext release];
  [pathModelView release];
  [displaySettings release];
  [_comments release];
  
  [scanPathName release];
  [invisiblePathName release];
  [statusMessage release];

  [_previewPanel release];
  
  [super dealloc];
}


- (NSString *)windowNibName {
  return @"DirectoryViewWindow";
}

- (NSString *)nameOfActiveMask {
  return displaySettings.fileItemMaskEnabled ? displaySettings.maskName : nil;
}

- (ItemPathModelView *)pathModelView {
  return pathModelView;
}

- (DirectoryView *)directoryView {
  return mainView;
}

- (DirectoryViewControlSettings *)directoryViewControlSettings {
  DirectoryViewControlSettings  *dvcs = [DirectoryViewControlSettings alloc];

  return [[dvcs initWithDisplaySettings: [[displaySettings copy] autorelease]
                       unzoomedViewSize: unzoomedViewSize
                           displayDepth: mainView.displayDepth] autorelease];
}

- (TreeContext *)treeContext {
  return treeContext;
}

- (AnnotatedTreeContext *)annotatedTreeContext {
  return [AnnotatedTreeContext annotatedTreeContext: treeContext comments: self.comments];
}

- (void) windowDidLoad {
  [mainView postInitWithPathModelView: pathModelView];
  
  [self updateFileDeletionSupport];

  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  
  //---------------------------------------------------------------- 
  // Miscellaneous initialisation

  [super windowDidLoad];
  
  NSAssert(invisiblePathName == nil, @"invisiblePathName unexpectedly set.");
  FileItem  *visibleTree = pathModelView.visibleTree;
  invisiblePathName = [visibleTree.path retain];

  NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;

  [nc addObserver: self
         selector: @selector(selectedItemChanged:)
             name: SelectedItemChangedEvent
           object: pathModelView];
  [nc addObserver: self
         selector: @selector(visibleTreeChanged:)
             name: VisibleTreeChangedEvent
           object: pathModelView];
  [nc addObserver: self
         selector: @selector(visiblePathLockingChanged:)
             name: VisiblePathLockingChangedEvent 
           object: pathModelView.pathModel];
  [nc addObserver: self
         selector: @selector(commentsChanged:)
             name: CommentsChangedEvent
           object: ControlPanelControl.singletonInstance];
  [nc addObserver: self
         selector: @selector(displaySettingsChanged:)
             name: DisplaySettingsChangedEvent
           object: ControlPanelControl.singletonInstance];
  [nc addObserver: self
         selector: @selector(displayFocusChanged:)
             name: DisplayFocusChangedEvent
           object: mainView];

  [userDefaults addObserver: self 
                 forKeyPath: FileDeletionTargetsKey
                    options: 0 
                    context: nil];
  [userDefaults addObserver: self 
                 forKeyPath: ConfirmFileDeletionKey
                    options: 0 
                    context: nil];
  [userDefaults addObserver: self 
                 forKeyPath: FileSizeUnitSystemKey
                    options: 0 
                    context: nil];

  [self propagateDisplaySettings];
  [self visibleTreeChanged: nil];

  // Set the window's initial size
  unzoomedViewSize = initialSettings.unzoomedViewSize;
  NSRect  frame = self.window.frame;
  frame.size = unzoomedViewSize;
  [self.window setFrame: frame display: NO];

  mainView.displayDepth = initialSettings.displayDepth;
  
  [self.window makeFirstResponder: mainView];
  [self.window makeKeyAndOrderFront: self];

  [nc postNotificationName: ViewWillOpenEvent object: self];
  
  [initialSettings release];
  initialSettings = nil;
}


// Invoked because the controller is the delegate for the window.
- (void) windowDidBecomeMain:(NSNotification *)notification {
  [itemSizeField setTextColor: NSColor.labelColor];
  [itemPathField setTextColor: NSColor.labelColor];

  [ControlPanelControl.singletonInstance mainWindowChanged: self];
}

- (void) windowDidResignMain:(NSNotification *)notification {
  [itemSizeField setTextColor: NSColor.secondaryLabelColor];
  [itemPathField setTextColor: NSColor.secondaryLabelColor];
}


// Invoked because the controller is the delegate for the window.
- (void) windowWillClose:(NSNotification *)notification {
  [NSNotificationCenter.defaultCenter postNotificationName: ViewWillCloseEvent object: self];
  [self autorelease];
}

// Invoked because the controller is the delegate for the window.
- (void) windowDidResize:(NSNotification *)notification {
  if (! self.window.zoomed) {
    // Keep track of the user-state size of the window, as this will be uses as
    // the initial size of derived views.
    unzoomedViewSize = self.window.frame.size;
  }
}


- (void) observeValueForKeyPath:(NSString *)keyPath
                       ofObject:(id)object
                         change:(NSDictionary *)change
                        context:(void *)context {
  if (object == NSUserDefaults.standardUserDefaults) {
    if ([keyPath isEqualToString: FileDeletionTargetsKey] ||
        [keyPath isEqualToString: ConfirmFileDeletionKey]) {
      [self updateFileDeletionSupport];
    } else if ([keyPath isEqualToString: FileSizeUnitSystemKey]) {
      [self fileSizeUnitSystemChanged];
    }
  }
}


- (IBAction) openFile:(id)sender {
  FileItem  *fileItem = pathModelView.selectedFileItem;

  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  NSWorkspace  *workspace = NSWorkspace.sharedWorkspace;
  NSString  *customApp = [userDefaults stringForKey: CustomFileOpenApplication];
  NSURL  *appUrl;

  if (customApp.length > 0) {
    NSLog(@"Opening %@ using custom app %@", fileItem.systemPath, customApp);
    appUrl = [NSURL fileURLWithPath: customApp];
  } else {
    appUrl = [workspace URLForApplicationToOpenURL: [NSURL fileURLWithPath: fileItem.systemPath]];
  }

  [self openFile: fileItem withApplication: appUrl];
}

- (IBAction) previewFile:(id)sender {
  if (QLPreviewPanel.sharedPreviewPanelExists && QLPreviewPanel.sharedPreviewPanel.visible) {
    [QLPreviewPanel.sharedPreviewPanel orderOut: nil];
  }
  else {
    [QLPreviewPanel.sharedPreviewPanel makeKeyAndOrderFront: nil];
  }
}

- (IBAction) revealFileInFinder:(id)sender {
  FileItem  *fileItem = pathModelView.selectedFileItem;
  NSString  *filePath = fileItem.systemPath;
  
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  NSString  *customApp = [userDefaults stringForKey: CustomFileRevealApplication];
  NSWorkspace  *workspace = NSWorkspace.sharedWorkspace;

  if (customApp.length > 0) {
    NSLog(@"Revealing %@ using custom app %@", fileItem.systemPath, customApp);

    [self openFile: fileItem withApplication: [NSURL fileURLWithPath: customApp]];
    return;
  }

  // Work-around for bug/limitation of NSWorkSpace. It apparently cannot select files that are
  // inside a package, unless the package is the root path. So check if the selected file is
  // inside a package. If so, use it as a root path.
  DirectoryItem  *ancestor = fileItem.parentDirectory;
  DirectoryItem  *package = nil;
 
  while (ancestor != nil) {
    if (ancestor.isPackage) {
      if (package != nil) {
        // The package in which the selected item resides is inside a package itself. Open this
        // inner package instead (as opening the selected file will not succeed).
        fileItem = package;
      }
      package = ancestor;
    }
    ancestor = ancestor.parentDirectory;
  }

  NSString  *rootPath = (package != nil) ? package.systemPath : invisiblePathName;

  if ([workspace selectFile: filePath inFileViewerRootedAtPath: rootPath]) {
    return; // All went okay
  }

  NSAlert *alert = [[[NSAlert alloc] init] autorelease];

  NSString  *msgFmt = 
    ( fileItem.isPackage
      ? NSLocalizedString(@"Failed to reveal the package \"%@\"", @"Alert message")
      : ( fileItem.isDirectory
          ? NSLocalizedString(@"Failed to reveal the folder \"%@\"", @"Alert message")
          : NSLocalizedString(@"Failed to reveal the file \"%@\"", @"Alert message")
         )
     );
  NSString  *msg = [NSString stringWithFormat: msgFmt, fileItem.pathComponent];

  [alert addButtonWithTitle: OK_BUTTON_TITLE];
  alert.messageText = msg;
  [alert setInformativeText: NOTE_IT_MAY_NOT_EXIST_ANYMORE];

  [alert beginSheetModalForWindow: self.window completionHandler: nil];
}


- (IBAction) deleteFile:(id)sender {
  FileItem  *selectedFile = pathModelView.selectedFileItem;
  BOOL  isDir = selectedFile.isDirectory;
  BOOL  isPackage = selectedFile.isPackage;

  // Packages whose contents are hidden (i.e. who are not represented as directories) are treated
  // schizophrenically for deletion: For deciding if a confirmation message needs to be shown, they
  // are treated as directories. However, for determining if they can be deleted they are treated as
  // files.

  if ( ( !(isDir || isPackage) && !confirmFileDeletion) ||
       (  (isDir || isPackage) && !confirmFolderDeletion) ) {
    // Delete the file/folder immediately, without asking for confirmation.
    [self deleteSelectedFile];
    
    return;
  }

  NSAlert  *alert = [[[NSAlert alloc] init] autorelease];
  NSString  *mainMsg;
  NSString  *infoMsg;
  NSString  *hardLinkMsg;

  if (isDir) {
    mainMsg = NSLocalizedString(@"Do you want to delete the folder \"%@\"?", @"Alert message");
    infoMsg = NSLocalizedString( 
      @"The selected folder, with all its contents, will be moved to Trash. Beware, any files in the folder that are not shown in the view will also be deleted", 
      @"Alert informative text");
    hardLinkMsg = NSLocalizedString(
      @"Note: The folder is hard-linked. It will take up space until all links to it are deleted",
      @"Alert additional informative text");
  }
  else if (isPackage) {
    mainMsg = NSLocalizedString(@"Do you want to delete the package \"%@\"?", @"Alert message");
    infoMsg = NSLocalizedString(@"The selected package will be moved to Trash",
                                @"Alert informative text" );
    hardLinkMsg = NSLocalizedString( 
      @"Note: The package is hard-linked. It will take up space until all links to it are deleted",
      @"Alert additional informative text");
  }
  else {
    mainMsg = NSLocalizedString(@"Do you want to delete the file \"%@\"?", @"Alert message");
    infoMsg = NSLocalizedString(@"The selected file will be moved to Trash",
                                @"Alert informative text");
    hardLinkMsg = NSLocalizedString( 
      @"Note: The file is hard-linked. It will take up space until all links to it are deleted",
      @"Alert additional informative text");
  }
  
  if (selectedFile.isHardLinked) {
    infoMsg = [NSString stringWithFormat: @"%@\n\n%@", infoMsg, hardLinkMsg];
  }

  [alert addButtonWithTitle: DELETE_BUTTON_TITLE];
  [alert addButtonWithTitle: CANCEL_BUTTON_TITLE];
  alert.messageText = [NSString stringWithFormat: mainMsg, selectedFile.pathComponent];
  alert.informativeText = infoMsg;

  [alert beginSheetModalForWindow: self.window completionHandler:^(NSModalResponse returnCode) {
    // Let the alert disappear, so that it is gone before the file is being deleted as this can
    // trigger another alert (namely when it fails).
    [alert.window orderOut: self];

    if (returnCode == NSAlertFirstButtonReturn) {
      // Delete confirmed.

      [self deleteSelectedFile];
    }
  }];
}


// Copies the path of selected file item to the pasteboard. Invoked via first responder.
- (IBAction) copy:(id)sender {
  FileItem  *selectedFile = pathModelView.selectedFileItem;
  NSPasteboard *pb = NSPasteboard.generalPasteboard;

  [pb declareTypes: @[NSPasteboardTypeString] owner: nil];
  [pb setString: selectedFile.path forType: NSPasteboardTypeString];
}


- (IBAction) showInfo:(id)sender {
  [ControlPanelControl.singletonInstance showInfoPanel];
}


- (void) searchForFiles:(NSString *)spec {
  FileItemTest  *overlayTest = nil;

  if (spec.length > 0) {
    StringContainmentTest  *stringTest =
      [[[StringContainmentTest alloc] initWithMatchTargets: @[spec]
                                             caseSensitive: NO] autorelease];
    ItemNameTest  *subTest = [[[ItemNameTest alloc] initWithStringTest: stringTest] autorelease];

    overlayTest = [[[SelectiveItemTest alloc] initWithSubItemTest: subTest
                                                        onlyFiles: YES] autorelease];
  }

  mainView.overlayTest = overlayTest;
}


- (BOOL) validateAction:(SEL)action {
  if (action == @selector(openFile:)) {
    return self.canOpenSelectedFile;
  }
  if (action == @selector(previewFile:)) {
    return self.canPreviewSelectedFile;
  }
  if (action == @selector(revealFileInFinder:)) {
    return self.canRevealSelectedFile;
  }
  if (action == @selector(deleteFile:)) {
    return self.canDeleteSelectedFile;
  }
  if (action == @selector(copy:)) {
    return self.canCopySelectedPathToPasteboard;
  }

  return NO;
}

- (BOOL) validateMenuItem:(NSMenuItem *)menuItem {
  SEL action = menuItem.action;

  if (action == @selector(deleteFile:)) {
    menuItem.title = pathModelView.selectedFileItem.isDirectory
      ? NSLocalizedStringFromTable(@"Delete Folder", @"Localizable", @"Menu item")
      : NSLocalizedStringFromTable(@"Delete File", @"Localizable", @"Menu item");
  }

  return [self validateAction: menuItem.action];
}


- (BOOL) isSelectedFileLocked {
  return pathModelView.pathModel.isVisiblePathLocked;
}


+ (NSArray *)fileDeletionTargetNames {
  static NSArray  *fileDeletionTargetNames = nil;
  
  if (fileDeletionTargetNames == nil) {
    fileDeletionTargetNames = [@[DeleteNothing, OnlyDeleteFiles, DeleteFilesAndFolders] retain];
  }
  
  return fileDeletionTargetNames;
}

- (void) showInformativeAlert:(NSAlert *)alert {
  [alert beginSheetModalForWindow: self.window completionHandler: nil];
}

#pragma mark - Quick Look panel support

- (BOOL)acceptsPreviewPanelControl:(QLPreviewPanel *)panel {
  return YES;
}

- (void)beginPreviewPanelControl:(QLPreviewPanel *)panel {
  // This document is now responsible of the preview panel. It is allowed to set the delegate, data
  // source and refresh panel.
  panel.delegate = self;
  panel.dataSource = self;
  self.previewPanel = panel;
}

- (void)endPreviewPanelControl:(QLPreviewPanel *)panel {
  // This document loses its responsibility on the preview panel. Until the next call to
  // -beginPreviewPanelControl: it must not change the panel's delegate, data source or refresh it.
  self.previewPanel = nil;
}

#pragma mark - QLPreviewPanelDataSource

- (NSInteger)numberOfPreviewItemsInPreviewPanel:(QLPreviewPanel *)panel {
  return 1;
}

- (id <QLPreviewItem>)previewPanel:(QLPreviewPanel *)panel
                previewItemAtIndex:(NSInteger)index {
  NSArray  *pathToSelectedItem = pathModelView.pathModel.itemPathToSelectedFileItem;
  return [[[DirectoryViewPreviewItem alloc] initWithPathToSelectedItem: pathToSelectedItem]
          autorelease];
}

#pragma mark - QLPreviewPanelDelegate

/* This delegate method provides the rect on screen from which the panel will zoom.
 *
 * This method is invoked multiple times when previewing a specific item. Nevertheless, the rect is
 * not cached as it may change during the preview. It is possible to move and resize the
 * DirectoryView window while the Quick Look panel is being shown.
 */
- (NSRect) previewPanel:(QLPreviewPanel *)panel
  sourceFrameOnScreenForPreviewItem:(id <QLPreviewItem>)item {

  NSArray  *path = ((DirectoryViewPreviewItem *)item).pathToSelectedItem;
  NSRect selectedItemRect = [mainView locationInViewForItemAtEndOfPath: path];

  // Check that the rect is visible on screen
  if (!NSIntersectsRect(mainView.visibleRect, selectedItemRect)) {
    return NSZeroRect;
  }

  // Convert to screen coordinates
  selectedItemRect = [mainView convertRectToBacking: selectedItemRect];
  selectedItemRect = [mainView convertRect: selectedItemRect toView: nil];
  selectedItemRect = [mainView.window convertRectToScreen: selectedItemRect];

  return selectedItemRect;
}

/* This delegate method provides the transition image for the Quick Look animation when showing and
 * hiding the panel.
 *
 * This method is invoked multiple times when previewing a specific item. Nevertheless, the rect is
 * not cached as it may change during the preview. It is possible to move and resize the
 * DirectoryView window while the Quick Look panel is being shown.
 */
- (id)previewPanel:(QLPreviewPanel *)panel
  transitionImageForPreviewItem:(id <QLPreviewItem>)item contentRect:(NSRect *)contentRect {

  NSArray  *path = ((DirectoryViewPreviewItem *)item).pathToSelectedItem;
  return [mainView imageInViewForItemAtEndOfPath: path];
}

@end // @implementation DirectoryViewControl


@implementation DirectoryViewControl (PrivateMethods)

- (BOOL) canOpenSelectedFile {
  FileItem  *selectedFile = pathModelView.selectedFileItem;

  return (self.isSelectedFileLocked

          // Can only open actual files
          && selectedFile.isPhysical
      
          // Can only open plain files and packages
          && ( !selectedFile.isDirectory || selectedFile.isPackage ));
}

- (BOOL) canPreviewSelectedFile {
  return self.isSelectedFileLocked && pathModelView.selectedFileItem.isPhysical;
}

- (BOOL) canRevealSelectedFile {
  return self.isSelectedFileLocked && pathModelView.selectedFileItem.isPhysical;
}

- (BOOL) canDeleteSelectedFile {
  FileItem  *selectedFile = pathModelView.selectedFileItem;

  return (self.isSelectedFileLocked

          // Can only delete actual files.
          && selectedFile.isPhysical

          // Can this type of item be deleted (according to the preferences)?
          && ((canDeleteFiles && !selectedFile.isDirectory)
              || (canDeleteFolders && selectedFile.isDirectory))

          // Can only delete the entire scan tree when it is an actual folder
          // within the volume. You cannot delete the root folder.
          && ! ( (selectedFile == pathModelView.scanTree)
                && [pathModelView.scanTree.systemPathComponent isEqualToString: @""])

          // Don't enable Click-through for deletion. The window needs to be
          // active for the file deletion controls to be enabled.
          && self.window.keyWindow);
}

- (BOOL) canCopySelectedPathToPasteboard {
  return self.isSelectedFileLocked;
}


- (void) deleteSelectedFile {
  FileItem  *selectedFile = pathModelView.selectedFileItem;
  NSURL  *fileUrl = [NSURL fileURLWithPath: selectedFile.systemPath];

  NSError  *error = nil;
  if ([NSFileManager.defaultManager trashItemAtURL: fileUrl
                                  resultingItemURL: nil
                                             error: &error]) {
    [treeContext deleteSelectedFileItem: pathModelView];
    
    return; // All went okay
  }

  NSAlert *alert = [[[NSAlert alloc] init] autorelease];

  NSString  *msgFmt = 
    ( [selectedFile isDirectory] 
      ? NSLocalizedString(@"Failed to delete the folder \"%@\"", @"Alert message")
      : NSLocalizedString( @"Failed to delete the file \"%@\"", @"Alert message") );
  NSString  *msg = [NSString stringWithFormat: msgFmt, selectedFile.pathComponent];
  NSString  *info = error.localizedDescription;
         
  [alert addButtonWithTitle: OK_BUTTON_TITLE];
  alert.messageText = msg;
  alert.informativeText = info;

  [alert beginSheetModalForWindow: self.window completionHandler: nil];
}


- (void) visibleTreeChanged:(NSNotification *)notification {
  FileItem  *visibleTree = pathModelView.visibleTree;

  [invisiblePathName release];
  invisiblePathName = [visibleTree.path retain];

  [self validateControls];

  // The status bar needs updating, as it shows the visible part
  [self updateSelectionInStatusbar: nil];
}

- (void) visiblePathLockingChanged:(NSNotification *)notification {
  [self validateControls];
}


- (void) selectedItemChanged:(NSNotification *)notification {
  NSString  *itemSizeString = notification.userInfo[FriendlySizeKey];

  [self updateSelectionInStatusbar: itemSizeString];

  if (pathModelView.pathModel.isVisiblePathLocked) {
    // Only when the visible path is locked can a change of selected item
    // affect the state of the controls.
    [self validateControls];
  }
}

- (void) commentsChanged:(NSNotification *)notification {
  if (self.window.isMainWindow) {
    _comments = [ControlPanelControl.singletonInstance.comments retain];
  }
}


- (void) displaySettingsChanged:(NSNotification *)notification {
  if (self.window.isMainWindow) {
    [displaySettings release];
    displaySettings = [ControlPanelControl.singletonInstance.displaySettings retain];

    [self propagateDisplaySettings];
  }
}

- (void) propagateDisplaySettings {
  ControlPanelControl  *controlPanel = ControlPanelControl.singletonInstance;

  mainView.treeDrawerSettings =
    [controlPanel instantiateDisplaySettings: displaySettings
                                     forTree: treeContext.scanTree
                                displayDepth: mainView.treeDrawerSettings.displayDepth];
  [mainView setShowEntireVolume: displaySettings.showEntireVolume];

  // How packages are shown may impact how the selected item is represented
  [self updateSelectionInStatusbar: nil];
}

- (void) displayFocusChanged:(NSNotification *)notification {
  NSString  *format = NSLocalizedString(@"Display focus changed to %@", @"Status update message");
  NSString  *value;
  if (mainView.displayDepth != NO_DISPLAY_DEPTH_LIMIT) {
    value = @(mainView.displayDepth).stringValue;
  } else {
    value = [NSBundle.mainBundle localizedStringForKey: UnlimitedDisplayFocusValue
                                                 value: nil
                                                 table: @"Names"];
  }

  [self showStatusUpdateMessage: [NSString stringWithFormat: format, value]];
}


- (void) updateSelectionInStatusbar:(NSString *)itemSizeString {
  if (statusMessage != nil) return;

  FileItem  *selectedItem = pathModelView.selectedFileItem;

  if (selectedItem == nil) {
    itemSizeField.stringValue = @"";
    itemPathField.stringValue = @"";
  
    return;
  }

  if (itemSizeString == nil) {
    itemSizeString = [treeContext stringForFileItemSize: selectedItem.itemSize];
  }
  itemSizeField.stringValue = itemSizeString;

  NSString  *itemPath;
  NSString  *relativeItemPath;

  if (!selectedItem.isPhysical) {
    itemPath = [NSBundle.mainBundle localizedStringForKey: selectedItem.label
                                                    value: nil table: @"Names"];
    relativeItemPath = itemPath;
  }
  else {
    itemPath = selectedItem.path;

    if (selectedItem.isDirectory
        && (!selectedItem.isPackage || mainView.treeDrawerSettings.drawItems == DRAW_FILES)) {
      // Append slash to indicate that the item is not a plain file. This is especially helpful
      // when the files in the directory are hidden by the display focus as the view then does not
      // show that the item is a directory.
      itemPath = [itemPath stringByAppendingString: @"/"];
    }
      
    NSAssert([itemPath hasPrefix: scanPathName], @"Invalid path prefix.");
    relativeItemPath = [itemPath substringFromIndex: scanPathName.length];
    if (relativeItemPath.absolutePath) {
      // Strip leading slash.
      relativeItemPath = [relativeItemPath substringFromIndex: 1];
    }
      
    if ([itemPath hasPrefix: invisiblePathName]) {
      // Create attributed string for the path of the selected item. The root of the scanned tree is
      // excluded from the path, and the part that is inside the visible tree is marked using
      // different attributes. This indicates which folder is shown in the view.

      NSMutableAttributedString  *attributedPath = 
        [[[NSMutableAttributedString alloc] initWithString: relativeItemPath] autorelease];

      NSUInteger  visibleLen = itemPath.length - invisiblePathName.length;
      if (visibleLen > 0 && visibleLen < relativeItemPath.length) {
        NSUInteger  firstVisibleCharIndex = relativeItemPath.length - visibleLen;
        if ([relativeItemPath characterAtIndex: firstVisibleCharIndex] == '/') {
          // Move the path separator also to the invisible path.
          visibleLen--;
        }
      }
        
      if (relativeItemPath.length > visibleLen) {
        [attributedPath addAttribute: NSForegroundColorAttributeName
                               value: NSColor.secondaryLabelColor
                               range: NSMakeRange(0, relativeItemPath.length - visibleLen)];
      }
        
      relativeItemPath = (NSString *)attributedPath;
    }
  }

  itemPathField.stringValue = relativeItemPath;
}

- (void) showStatusUpdateMessage:(NSString *)message {
  if (statusMessage == message) return;

  // Set or modify, or even clear the temporary status message
  [message retain];
  [statusMessage release];
  statusMessage = message;

  if (message == nil) {
    // The message was cleared. Show the path again
    [self updateSelectionInStatusbar: nil];
  } else {
    itemPathField.stringValue = statusMessage;

    // Clear the message after a short delay
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC * 2), dispatch_get_main_queue(),
                   ^() {
      if (statusMessage != message) return;

      [statusMessage release];
      statusMessage = nil;

      [self updateSelectionInStatusbar: nil];
    });
  }
}

- (void) validateControls {
  // Note: Maybe not strictly necessary, as toolbar seems to frequently auto-update its visible
  // items (unnecessarily often it seems). Nevertheless, it's good to do so explicitly, in response
  // to relevant events.
  [self.window.toolbar validateVisibleItems];
}


- (void) updateFileDeletionSupport {
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  
  NSString  *fileDeletionTargets = [userDefaults stringForKey: FileDeletionTargetsKey];

  canDeleteFiles = (
    (
      [fileDeletionTargets isEqualToString: OnlyDeleteFiles] ||
      [fileDeletionTargets isEqualToString: DeleteFilesAndFolders]
    ) &&
    [PreferencesPanelControl appHasDeletePermission]
  );
  canDeleteFolders = (
    [fileDeletionTargets isEqualToString: DeleteFilesAndFolders] &&
    [PreferencesPanelControl appHasDeletePermission]
  );
  confirmFileDeletion = [[userDefaults objectForKey: ConfirmFileDeletionKey] boolValue];
  confirmFolderDeletion = [[userDefaults objectForKey: ConfirmFolderDeletionKey] boolValue];

  [self validateControls];
}

- (void) fileSizeUnitSystemChanged {
  [self updateSelectionInStatusbar: nil];
}

- (void) openFile:(FileItem *)fileItem withApplication:(NSURL *)appUrl {
  NSWorkspace  *workspace = NSWorkspace.sharedWorkspace;
  NSString  *filePath = fileItem.systemPath;

  [workspace openURLs: @[[NSURL fileURLWithPath: filePath]]
 withApplicationAtURL: appUrl
          configuration: [NSWorkspaceOpenConfiguration configuration]
    completionHandler: ^(NSRunningApplication *app, NSError *error) {
    if (error == nil) {
      NSLog(@"Opened %@ using %@", filePath, appUrl);
      return;
    }

    NSLog(@"Failed to open %@ using %@: %@", filePath, appUrl, error.description);
    dispatch_async(dispatch_get_main_queue(), ^() {
      NSAlert *alert = [[[NSAlert alloc] init] autorelease];

      NSString  *msgFmt =
        ( fileItem.isPackage
          ? NSLocalizedString(@"Failed to open the package \"%@\"", @"Alert message")
          : ( fileItem.isDirectory
              // Opening directories should not be enabled, but handle it anyway
              // here, just for robustness...
              ? NSLocalizedString(@"Failed to open the folder \"%@\"", @"Alert message")
              : NSLocalizedString(@"Failed to open the file \"%@\"", @"Alert message") ) );
      NSString  *msg = [NSString stringWithFormat: msgFmt, fileItem.pathComponent];

      [alert addButtonWithTitle: OK_BUTTON_TITLE];
      alert.messageText = msg;
      [alert setInformativeText: NOTE_IT_MAY_NOT_EXIST_ANYMORE];

      [alert beginSheetModalForWindow: self.window completionHandler: nil];
    });
  }];
}


@end // @implementation DirectoryViewControl (PrivateMethods)


@implementation DirectoryViewPreviewItem

- (instancetype) initWithPathToSelectedItem:(NSArray *)pathToSelectedItemVal {
  if (self = [super init]) {
    pathToSelectedItem = [pathToSelectedItemVal retain];
  }

  return self;
}

- (void) dealloc {
  [pathToSelectedItem release];

  [super dealloc];
}

- (NSURL *)previewItemURL {
  return [NSURL fileURLWithPath: self.selectedItem.systemPath];
}

- (NSArray *)pathToSelectedItem {
  return pathToSelectedItem;
}

- (FileItem *)selectedItem {
  return (FileItem *)pathToSelectedItem.lastObject;
}

@end // @implementation DirectoryViewPreviewItem
