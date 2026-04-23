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

#import <Cocoa/Cocoa.h>

// Deletion options
extern NSString  *DeleteNothing;
extern NSString  *OnlyDeleteFiles;
extern NSString  *DeleteFilesAndFolders;

// Notifications when opening and closing views
extern NSString  *ViewWillOpenEvent;
extern NSString  *ViewWillCloseEvent;

@class DirectoryView;
@class ItemPathModel;
@class ItemPathModelView;
@class DirectoryViewControlSettings;
@class DirectoryViewDisplaySettings;
@class TreeContext;
@class AnnotatedTreeContext;

@interface DirectoryViewControl : NSWindowController<NSMenuItemValidation> {

  // Main window
  IBOutlet NSTextField  *itemPathField;
  IBOutlet NSTextField  *itemSizeField;
  IBOutlet DirectoryView  *mainView;
  
  ItemPathModelView  *pathModelView;
  TreeContext  *treeContext;
  
  // The "initialSettings" field is only used between initialization and subsequent creation of the
  // window. It's subsequently dynamically created as needed.
  DirectoryViewControlSettings  *initialSettings;

  DirectoryViewDisplaySettings  *displaySettings;

  BOOL  canDeleteFiles;
  BOOL  canDeleteFolders;
  BOOL  confirmFileDeletion;
  BOOL  confirmFolderDeletion;

  // The (absolute) path of the scan tree.
  NSString  *scanPathName;
  
  // The part of the (absolute) path that is outside the visible tree.
  NSString  *invisiblePathName;

  // Status message that is temporarily shown in the status bar
  NSString  *statusMessage;

  // The size of the view when it is not zoomed.
  NSSize  unzoomedViewSize;
}

- (IBAction) openFile:(id)sender;
- (IBAction) previewFile:(id)sender;
- (IBAction) revealFileInFinder:(id)sender;
- (IBAction) deleteFile:(id)sender;
- (IBAction) showInfo:(id)sender;

- (void) searchForFiles:(NSString *)searchSpec;

// Override designated initialisers
- (instancetype) initWithWindow:(NSWindow *)window NS_UNAVAILABLE;
- (instancetype) initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;

- (instancetype) initWithAnnotatedTreeContext:(AnnotatedTreeContext *)treeContext;
- (instancetype) initWithAnnotatedTreeContext:(AnnotatedTreeContext *)treeContext
                                    pathModel:(ItemPathModel *)itemPathModel
                                     settings:(DirectoryViewControlSettings *)settings NS_DESIGNATED_INITIALIZER;

@property (nonatomic, readonly, copy) NSString *comments;

@property (nonatomic, readonly, strong) NSString *nameOfActiveMask;

@property (nonatomic, readonly, strong) ItemPathModelView *pathModelView;

@property (nonatomic, readonly, strong) DirectoryView *directoryView;

/* Returns a newly created object that represents the current settings of the view. It can
 * subsequently be safely modified. This will not affect the view.
 */
@property (nonatomic, readonly, strong) DirectoryViewControlSettings *directoryViewControlSettings;

@property (nonatomic, readonly, strong) TreeContext *treeContext;
@property (nonatomic, readonly, strong) AnnotatedTreeContext *annotatedTreeContext;

/* Returns YES iff the action is currently enabled. 
 *
 * Only works for a subset of of actions, e.g. openFile: and deleteFile:. See implementation for
 * complete list, which can be extended when needed.
 */
- (BOOL) validateAction:(SEL)action;

/* Returns YES iff the selection is currently locked, which means that it does not change when the
 * mouse position changes.
 */
@property (nonatomic, getter=isSelectedFileLocked, readonly) BOOL selectedFileLocked;

@property (class, nonatomic, readonly) NSArray *fileDeletionTargetNames;

- (void) showInformativeAlert:(NSAlert *)alert;

@end
